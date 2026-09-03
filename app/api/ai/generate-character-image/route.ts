import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getUserPoints, deductPoints, PointsAction } from '@/lib/points'
import { db } from '@/lib/db'
import { aiGenerationTasks } from '@/lib/schema'
import { v4 as uuidv4 } from 'uuid'
import { eq } from 'drizzle-orm'

/**
 * POST /api/ai/generate-character-image
 *
 * Body (单个请求):
 * {
 *   prompt: string,                // 必需：主角生成提示词
 *   aspectRatio?: "1:1",           // 可选：画面比例，默认 1:1
 *   referenceImage?: string,         // 可选：用户上传的参考图URL（img2img模式）
 *   webhookUrl?: string            // 可选：自定义 webhook URL
 * }
 *
 * Body (批量请求):
 * {
 *   characters: [
 *     { id: string, prompt: string, size?: string, referenceImage?: string }
 *   ]
 * }
 *
 * 使用 GPT Image 2 模型生成主角图片：
 * - 文生图模式：gpt-image-2-text-to-image
 * - 图生图模式：gpt-image-2-image-to-image
 * - 默认分辨率：2K
 *
 * 支持两种模式：
 * 1. webhook 模式：如果配置了 webhook，立即返回 taskId
 * 2. 轮询模式：如果没有配置 webhook，后端轮询任务状态直到完成
 *
 * 每次成功生成主角扣除1积分，失败不扣积分
 */

// Kie.ai API 配置
const KIE_API_URL = "https://api.kie.ai/api/v1/jobs/createTask"
const KIE_QUERY_URL = "https://api.kie.ai/api/v1/jobs/recordInfo"
const KIE_API_KEY = process.env.KIE_API_KEY!

// Webhook URL - 如果配置了环境变量则使用
const WEBHOOK_URL = process.env.KIE_WEBHOOK_URL

// 生成单个主角图片
async function generateSingleCharacter(
  prompt: string,
  aspectRatio?: string,
  webhookUrl?: string,
  userId?: string,
  projectId?: string,
  itemId?: string,
  versionId?: string,
  versionGroupId?: string,
  referenceImage?: string   // 用户上传的参考图URL（图生图模式）
): Promise<{ success: boolean; images?: any[]; requestId?: string; error?: string }> {
  if (!prompt || !prompt.trim()) {
    return { success: false, error: "Prompt is required" }
  }

  // 判断是否使用图生图模式
  const useImageToImage = referenceImage && typeof referenceImage === 'string' && referenceImage.trim().length > 0

  // GPT Image 2 API 请求体
  const kieRequestBody: any = {
    // 文生图：gpt-image-2-text-to-image；图生图：gpt-image-2-image-to-image
    model: useImageToImage ? "gpt-image-2-image-to-image" : "gpt-image-2-text-to-image",
    input: useImageToImage
      ? {
          prompt: prompt,
          input_urls: [referenceImage],
          resolution: "2K",
        }
      : {
          prompt: prompt,
          resolution: "2K",
        }
  }

  // 如果配置了 webhookUrl，添加到请求体
  const finalWebhookUrl = webhookUrl || WEBHOOK_URL
  if (finalWebhookUrl) {
    kieRequestBody.callBackUrl = finalWebhookUrl
  }

  // 调用 Kie.ai API 创建任务
  const response = await fetch(KIE_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KIE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(kieRequestBody)
  })

  if (!response.ok) {
    const errorData = await response.text()
    console.error('Kie.ai API error:', response.status, errorData)
    return { success: false, error: "AI generation failed" }
  }

  const data = await response.json()
  if (data.code !== 200) {
    console.error('Kie.ai API returned error:', data)
    return { success: false, error: data.msg || "AI generation failed" }
  }

  const taskId = data.data?.taskId
  if (!taskId) {
    console.error('No taskId returned from Kie.ai:', data)
    return { success: false, error: "No task ID returned" }
  }

  // 判断是否使用 webhook 模式
  const useWebhookMode = !!finalWebhookUrl

  // 存储任务映射（用于 webhook 回调时扣除积分）
  if (userId) {
    try {
      await db.insert(aiGenerationTasks).values({
        id: uuidv4(),
        taskId: taskId,
        userId: userId,
        taskType: 'generate_character',
        pointsAmount: 1,
        pointsDeducted: false,
        status: 'pending',
        projectId: projectId || null,
        versionId: versionId || null,
        itemId: itemId || null,
        versionGroupId: versionGroupId || null,
        newVersionId: null,
      })
      console.log('[generate-character-image] 任务映射已存储:', { taskId, userId, versionId, versionGroupId })
    } catch (error) {
      console.error('[generate-character-image] 存储任务映射失败:', error)
      // 不阻止任务继续，因为积分扣除会在 webhook 回调时处理
    }
  }

  if (useWebhookMode) {
    return { success: true, requestId: taskId }
  }

  // 轮询模式：后端轮询任务状态直到完成
  // 8分钟超时 = 160次 × 3秒
  const maxRetries = 160
  let retryCount = 0
  let taskResult: any = null

  while (retryCount < maxRetries) {
    try {
      const queryResponse = await fetch(`${KIE_QUERY_URL}?taskId=${taskId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${KIE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      })

      if (queryResponse.ok) {
        const queryData = await queryResponse.json()
        if (queryData.code === 200 && queryData.data) {
          const taskData = queryData.data
          if (taskData.state === 'success' && taskData.resultJson) {
            try {
              const resultData = JSON.parse(taskData.resultJson)
              taskResult = resultData
              break
            } catch (parseError) {
              return { success: false, error: "Invalid result format" }
            }
          } else if (taskData.state === 'fail') {
            return { success: false, error: taskData.failMsg || "AI generation failed" }
          }
        }
      }

      await new Promise(resolve => setTimeout(resolve, 3000))
      retryCount++
    } catch (queryError) {
      console.error('Error querying Kie.ai task:', queryError)
      retryCount++
    }
  }

  if (!taskResult) {
    return { success: false, error: "AI generation timeout" }
  }

  const resultUrls = taskResult.resultUrls || []
  const images = resultUrls.map((url: string) => ({ url }))

  if (images.length === 0) {
    return { success: false, error: "No images generated" }
  }

  // 轮询模式：任务已完成，立即扣除积分
  if (userId) {
    try {
      // 更新任务状态为成功
      await db.update(aiGenerationTasks)
        .set({ 
          status: 'success',
          pointsDeducted: true,
          updatedAt: new Date()
        })
        .where(eq(aiGenerationTasks.taskId, taskId))

      // 扣除积分
      await deductPoints(
        userId,
        1,
        undefined,
        PointsAction.GENERATE_CHARACTER
      )
      console.log(`[generate-character-image] 轮询模式：用户 ${userId} 成功生成主角，扣除1积分`)
    } catch (deductError) {
      console.error('[generate-character-image] 轮询模式扣除积分失败:', deductError)
      // 即使扣除积分失败，也返回成功结果
    }
  }

  return { success: true, images, requestId: taskId }
}

export async function POST(request: NextRequest) {
  try {
    // 验证用户登录状态
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '用户未登录' }, { status: 401 })
    }

    // 读取原始请求体
    const rawText = await request.text()
    console.log('[generate-character-image] rawBody:', rawText)

    let body: any = {}
    try {
      body = JSON.parse(rawText)
    } catch (e) {
      return NextResponse.json({ error: 'Invalid JSON body', details: String(e) }, { status: 400 })
    }

    // 检查是否是批量请求
    const isBatch = Array.isArray(body?.characters) && body.characters.length > 0

    // 计算需要扣除的积分数量（每个主角2积分）
    const characterCount = isBatch ? body.characters.length : 1
    const requiredPoints = characterCount * 1

    // 检查积分是否足够
    const userPoints = await getUserPoints(session.user.id)
    if (userPoints < requiredPoints) {
      return NextResponse.json(
        { 
          error: '积分不足',
          code: 'INSUFFICIENT_POINTS',
          currentPoints: userPoints,
          requiredPoints: requiredPoints
        },
        { status: 400 }
      )
    }

    // 批量请求模式
    if (isBatch) {
      const characters = body.characters
      console.log('[generate-character-image] batch request:', { count: characters.length })

      const results: any[] = []
      let successCount = 0

      for (const c of characters) {
        const promptText = c.prompt || c.generationPrompt || c.generation_prompt || ''
        const characterId = c.id || null
        const referenceImage = typeof c.referenceImage === 'string' ? c.referenceImage : undefined

        console.log('[generate-character-image] processing character:', { characterId, promptLength: promptText.length, hasReferenceImage: !!referenceImage })

        if (!promptText.trim()) {
          results.push({
            characterId,
            error: 'Missing prompt for this character'
          })
          continue
        }

        const result = await generateSingleCharacter(promptText, "1:1", undefined, session.user.id, body.projectId, characterId, body.versionId, body.versionGroupId, referenceImage)
        
        if (result.success) {
          console.log('[generate-character-image] character generated:', { characterId, requestId: result.requestId, imageCount: result.images?.length })
          successCount++
        } else {
          console.error('[generate-character-image] character generation failed:', { characterId, error: result.error })
        }

        results.push({
          characterId,
          images: result.success ? result.images : undefined,
          requestId: result.requestId,
          error: result.error
        })
      }

      // 批量模式：积分扣除在 webhook 回调或轮询完成时进行
      // 这里不再扣除积分，因为任务可能还在处理中（webhook 模式）
      console.log('[generate-character-image] batch complete:', { total: results.length, success: successCount })
      return NextResponse.json({ success: true, results })
    }

    // 单个请求模式
    const { prompt, aspectRatio, webhookUrl, projectId, itemId, versionId, versionGroupId, referenceImage } = body
    console.log('[generate-character-image] single request:', { promptLength: prompt?.length, aspectRatio, hasWebhook: !!webhookUrl, projectId, versionId, versionGroupId, hasReferenceImage: !!referenceImage })

    const result = await generateSingleCharacter(prompt, aspectRatio, webhookUrl, session.user.id, projectId, itemId, versionId, versionGroupId, referenceImage)

    if (!result.success) {
      console.error('[generate-character-image] generation failed:', { error: result.error })
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    // 积分扣除逻辑：
    // - Webhook 模式：在 webhook 回调成功时扣除（已在 generateSingleCharacter 中存储任务映射）
    // - 轮询模式：在 generateSingleCharacter 中已完成扣除
    // 这里不再需要扣除积分

    console.log('[generate-character-image] success:', { requestId: result.requestId, imageCount: result.images?.length })
    return NextResponse.json({
      success: true,
      images: result.images,
      requestId: result.requestId
    })

  } catch (error) {
    console.error('[generate-character-image] API error:', error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
