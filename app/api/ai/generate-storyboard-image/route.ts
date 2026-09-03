import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getUserPoints, deductPoints, PointsAction } from '@/lib/points'
import { db } from '@/lib/db'
import { aiGenerationTasks } from '@/lib/schema'
import { v4 as uuidv4 } from 'uuid'
import { eq } from 'drizzle-orm'

/**
 * POST /api/ai/generate-storyboard-image
 *
 * Body (单个请求):
 * {
 *   storyboardPrompt: string,        // 必需：分镜图生成提示词
 *   aspectRatio: "16:9" | "9:16",    // 必需：画面比例
 *   resolution?: "2K" | "4K",        // 可选：分辨率，默认 2K（GPT Image 2）
 *   characterImages?: string[]       // 可选：角色图片URL数组（最多16张，GPT Image 2 img2img 支持）
 *   referenceImage?: string          // 可选：用户上传的参考图URL（场景参考图）
 *   webhookUrl?: string              // 可选：自定义 webhook URL
 *   firstFramePrompt?: string        // 可选：首帧提示词（首尾帧模式使用）
 *   lastFramePrompt?: string         // 可选：尾帧提示词（首尾帧模式使用）
 * }
 *
 * Body (批量请求):
 * {
 *   scenes: [
 *     { id: string, storyboardPrompt: string, aspectRatio: "16:9" | "9:16", characterImages?: string[], firstFramePrompt?: string, lastFramePrompt?: string, referenceImage?: string }
 *   ]
 * }
 *
 * 使用 GPT Image 2 模型生成：
 * - 文生图：gpt-image-2-text-to-image（无参考图、无角色图时）
 * - 图生图：gpt-image-2-image-to-image（有参考图或角色图时）
 * - 默认分辨率：2K
 * - 支持最多16张参考图
 *
 * 支持两种模式：
 * 1. webhook 模式：如果配置了 webhook，立即返回 taskId
 * 2. 轮询模式：如果没有配置 webhook，后端轮询任务状态直到完成
 *
 * 积分计算：
 * - 普通模式：每个分镜图 1 积分
 * - 首尾帧模式：每个分镜图 2 积分（首帧+尾帧各1积分）
 */

// Kie.ai API 配置
const KIE_API_URL = "https://api.kie.ai/api/v1/jobs/createTask"
const KIE_QUERY_URL = "https://api.kie.ai/api/v1/jobs/recordInfo"
const KIE_API_KEY = process.env.KIE_API_KEY!

// Webhook URL - 如果配置了环境变量则使用
const WEBHOOK_URL = process.env.KIE_WEBHOOK_URL

/**
 * 生成首帧或尾帧的单个图片
 * 使用 GPT Image 2 模型：
 * - 文生图：gpt-image-2-text-to-image
 * - 图生图：gpt-image-2-image-to-image（有角色图或参考图时）
 * - 默认分辨率：2K
 */
async function generateFrameImage(
  prompt: string,
  aspectRatio: string,
  characterImages?: string[],
  webhookUrl?: string,
  userId?: string,
  projectId?: string,
  itemId?: string,
  versionId?: string,
  versionGroupId?: string,
  options?: {
    firstFramePrompt?: string
    lastFramePrompt?: string
    regenerateFrameType?: 'first' | 'last'  // 重新生成单个帧的类型
    referenceImage?: string   // 用户上传的参考图URL（图生图模式）
  }
): Promise<{
  success: boolean
  images?: {
    firstFrame?: { url: string }
    lastFrame?: { url: string }
    default?: { url: string }
  }
  requestId?: string
  error?: string
  useWebhook?: boolean
}> {
  if (!prompt || !prompt.trim()) {
    return { success: false, error: "Prompt is required" }
  }

  if (!['16:9', '9:16'].includes(aspectRatio)) {
    return { success: false, error: "aspectRatio 只支持 '16:9' 或 '9:16'" }
  }

  // 判断是否有图生图输入（用户参考图 + 角色图）
  const hasImageInput = (options?.referenceImage && typeof options.referenceImage === 'string' && options.referenceImage.trim().length > 0)
    || (Array.isArray(characterImages) && characterImages.length > 0 && characterImages.some((item: any) => {
      const url = typeof item === 'object' && item !== null && 'imageUrl' in item ? item.imageUrl : item
      return typeof url === 'string' && url.trim().length > 0
    }))

  // 构建 input_urls：有图生图输入时用 gpt-image-2-image-to-image，最多16张图
  let imageInputList: string[] = []
  if (options?.referenceImage && typeof options.referenceImage === 'string' && options.referenceImage.trim().length > 0) {
    imageInputList.push(options.referenceImage)
  }
  if (Array.isArray(characterImages) && characterImages.length > 0) {
    const charUrls = characterImages
      .slice(0, 16)
      .map((item: any) => {
        if (typeof item === 'object' && item !== null && 'imageUrl' in item) {
          return item.imageUrl
        }
        return item as string
      })
      .filter((url: string) => typeof url === 'string' && url.trim().length > 0)
    imageInputList.push(...charUrls)
  }
  // 最多16张图（GPT Image 2 img2img 支持最多16张）
  imageInputList = imageInputList.slice(0, 16)

  // GPT Image 2 API 请求体
  const kieRequestBody: any = {
    // 有图生图输入时用 gpt-image-2-image-to-image，否则用 gpt-image-2-text-to-image
    model: hasImageInput ? "gpt-image-2-image-to-image" : "gpt-image-2-text-to-image",
    input: hasImageInput
      ? {
          prompt: prompt,
          input_urls: imageInputList,
          aspect_ratio: aspectRatio,
          resolution: "2K",
        }
      : {
          prompt: prompt,
          aspect_ratio: aspectRatio,
          resolution: "2K",
        }
  }

  // 配置 webhook（环境变量优先，支持前端覆盖）
  const finalWebhookUrl = webhookUrl || WEBHOOK_URL
  if (finalWebhookUrl) {
    kieRequestBody.callBackUrl = finalWebhookUrl
  }

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

  // 检查是否使用 webhook 模式
  const useWebhookMode = !!finalWebhookUrl

  if (useWebhookMode) {
    // Webhook 模式：存储任务映射（用于 webhook 回调时处理结果）
    // 存储两个任务：一个用于首帧，一个用于尾帧
    // 通过 itemId 后缀区分：itemId_first 和 itemId_last
    const promptType = prompt === options?.firstFramePrompt ? 'first' : 'last'
    
    if (userId) {
      try {
        // 获取完整的 itemId（可能需要从外部传入）
        const baseItemId = itemId || null
        const frameItemId = baseItemId ? `${baseItemId}_${promptType}` : null
        
        await db.insert(aiGenerationTasks).values({
          id: uuidv4(),
          taskId: taskId,
          userId: userId,
          taskType: 'generate_storyboard_frame',
          pointsAmount: 1,
          pointsDeducted: false,
          status: 'pending',
          projectId: projectId || null,
          versionId: versionId || null,
          itemId: frameItemId || null,
          versionGroupId: versionGroupId || null,
          newVersionId: null,
        })
        console.log('[generate-storyboard-image] generateFrameImage 任务映射已存储:', { taskId, userId, itemId: frameItemId, promptType })
      } catch (error) {
        console.error('[generate-storyboard-image] generateFrameImage 存储任务映射失败:', error)
      }
    }
    console.log('[generate-storyboard-image] generateFrameImage 使用 webhook 模式:', { taskId, promptType })
    return { success: true, images: { default: { url: '' } }, requestId: taskId, useWebhook: true }
  }

  // 轮询模式获取结果
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

  return { success: true, images: { default: images[0] }, requestId: taskId }
}

/**
 * 生成单个分镜图（支持首尾帧模式）
 * 使用 GPT Image 2 模型，默认为 2K 分辨率
 * 如果提供了 firstFramePrompt 和 lastFramePrompt，会并行生成首帧和尾帧
 */
async function generateSingleStoryboard(
  storyboardPrompt: string,
  aspectRatio: string,
  characterImages?: string[],
  webhookUrl?: string,
  userId?: string,
  projectId?: string,
  itemId?: string,
  versionId?: string,
  versionGroupId?: string,
  options?: {
    firstFramePrompt?: string
    lastFramePrompt?: string
    regenerateFrameType?: 'first' | 'last'  // 只重新生成单个帧
    referenceImage?: string   // 新增：用户上传的参考图URL
  }
): Promise<{
  success: boolean
  images?: {
    firstFrame?: { url: string }
    lastFrame?: { url: string }
    default?: { url: string }  // 兼容模式
  }
  requestId?: string
  requestIds?: string[]  // 首尾帧模式返回两个 taskId
  error?: string
}> {

  // 如果指定了 regenerateFrameType，只生成单个帧
  if (options?.regenerateFrameType) {
    const framePrompt = options.regenerateFrameType === 'first'
      ? options.firstFramePrompt
      : options.lastFramePrompt

    if (!framePrompt) {
      return { success: false, error: `Missing ${options.regenerateFrameType}FramePrompt` }
    }

    console.log(`[generate-storyboard-image] 重新生成单个${options.regenerateFrameType}帧:`, {
      prompt: framePrompt.substring(0, 50) + '...',
      hasWebhook: !!webhookUrl,
      hasReferenceImage: !!options.referenceImage
    })

    const frameResult = await generateFrameImage(
      framePrompt,
      aspectRatio,
      characterImages,
      webhookUrl,
      userId,
      projectId,
      itemId,
      versionId,
      versionGroupId,
      options
    )
    
    // 检查是否使用 webhook 模式
    const useWebhookMode = frameResult.useWebhook

    if (useWebhookMode) {
      console.log('[generate-storyboard-image] 单帧模式使用 webhook 模式')
      return {
        success: true,
        images: {
          [options.regenerateFrameType === 'first' ? 'firstFrame' : 'lastFrame']: { url: '' }
        },
        requestId: frameResult.requestId,
        // 返回单个 taskId
        requestIds: [frameResult.requestId].filter(Boolean) as string[]
      }
    }

    // 轮询模式：直接返回结果
    const imageUrl = (frameResult.images as any)?.[0]?.url
    
    if (imageUrl) {
      // 扣除积分（单个帧 1 积分）
      if (userId) {
        try {
          await deductPoints(
            userId,
            1,
            undefined,
            PointsAction.GENERATE_STORYBOARD
          )
          console.log(`[generate-storyboard-image] 单帧模式：用户 ${userId} 生成分镜图，扣除1积分`)
        } catch (deductError) {
          console.error('[generate-storyboard-image] 扣除积分失败:', deductError)
        }
      }
      
      return { 
        success: true, 
        images: {
          [options.regenerateFrameType === 'first' ? 'firstFrame' : 'lastFrame']: { url: imageUrl }
        },
        requestId: frameResult.requestId
      }
    }
    
    return { 
      success: false, 
      error: frameResult.error || 'Failed to generate frame'
    }
  }
  
  const hasFirstLastFrame = options?.firstFramePrompt && options?.lastFramePrompt
  
  // 如果有首尾帧提示词，使用首尾帧模式
  if (hasFirstLastFrame) {
    console.log('[generate-storyboard-image] 首尾帧模式:', {
      firstFramePrompt: options?.firstFramePrompt?.substring(0, 50) + '...',
      lastFramePrompt: options?.lastFramePrompt?.substring(0, 50) + '...',
      hasWebhook: !!webhookUrl
    })
    
    // 并行生成首帧和尾帧（传递所有参数用于存储任务映射）
    const [firstFrameResult, lastFrameResult] = await Promise.all([
      generateFrameImage(options!.firstFramePrompt!, aspectRatio, characterImages, webhookUrl, userId, projectId, itemId, versionId, versionGroupId, options),
      generateFrameImage(options!.lastFramePrompt!, aspectRatio, characterImages, webhookUrl, userId, projectId, itemId, versionId, versionGroupId, options)
    ])
    // 检查是否使用 webhook 模式
    const useWebhookMode = firstFrameResult.useWebhook || lastFrameResult.useWebhook

    if (useWebhookMode) {
      // Webhook 模式：返回两个 taskId，积分在 webhook 回调时扣除
      console.log('[generate-storyboard-image] 首尾帧模式使用 webhook 模式')
      return {
        success: true,
        images: {
          firstFrame: { url: '' },
          lastFrame: { url: '' }
        },
        // 返回两个 taskId，前端需要等待两个 Pusher 结果
        requestId: firstFrameResult.requestId,
        requestIds: [firstFrameResult.requestId, lastFrameResult.requestId].filter(Boolean) as string[]
      }
    }

    const images: any = {}
    
    if (firstFrameResult.success && (firstFrameResult.images as any)?.[0]?.url) {
      images.firstFrame = { url: (firstFrameResult.images as any)[0].url }
    }
    
    if (lastFrameResult.success && (lastFrameResult.images as any)?.[0]?.url) {
      images.lastFrame = { url: (lastFrameResult.images as any)[0].url }
    }
    
    // 至少要有一个成功
    if (Object.keys(images).length > 0) {
      // 扣除积分（首尾帧各1积分，共2积分）- 轮询模式下立即扣除
      if (userId) {
        try {
          await deductPoints(
            userId,
            2,
            undefined,
            PointsAction.GENERATE_STORYBOARD
          )
          console.log(`[generate-storyboard-image] 首尾帧模式：用户 ${userId} 生成分镜图，扣除2积分`)
        } catch (deductError) {
          console.error('[generate-storyboard-image] 扣除积分失败:', deductError)
        }
      }
      
      return { 
        success: true, 
        images,
        requestId: firstFrameResult.requestId || lastFrameResult.requestId
      }
    }
    
    // 两个都失败
    return { 
      success: false, 
      error: firstFrameResult.error || lastFrameResult.error || 'Failed to generate frames'
    }
  }
  
  // 普通模式：使用原有逻辑
  const result = await generateSingleStoryboardOriginal(
    storyboardPrompt,
    aspectRatio,
    characterImages,
    webhookUrl,
    userId,
    projectId,
    itemId,
    versionId,
    versionGroupId,
    options?.referenceImage   // 新增：传递用户参考图
  )
  
  // 转换返回格式以匹配接口
  if (result.success && result.images) {
    return {
      success: true,
      images: {
        default: (result.images as any)[0] // 兼容模式：使用 default 作为默认图片
      },
      requestId: result.requestId
    }
  }
  
  return result
}

/**
 * 原始的单个分镜图生成（用于普通模式）
 * 使用 GPT Image 2 模型：
 * - 文生图：gpt-image-2-text-to-image（无参考图、无角色图时）
 * - 图生图：gpt-image-2-image-to-image（有参考图或角色图时）
 * - 默认分辨率：2K
 */
async function generateSingleStoryboardOriginal(
  storyboardPrompt: string,
  aspectRatio: string,
  characterImages?: string[],
  webhookUrl?: string,
  userId?: string,
  projectId?: string,
  itemId?: string,
  versionId?: string,
  versionGroupId?: string,
  referenceImage?: string   // 用户上传的参考图URL（图生图模式）
): Promise<{
  success: boolean
  images?: {
    firstFrame?: { url: string }
    lastFrame?: { url: string }
    default?: { url: string }
  }
  requestId?: string
  error?: string
}> {
  if (!storyboardPrompt || !storyboardPrompt.trim()) {
    return { success: false, error: "Prompt is required" }
  }

  // 验证画面比例
  if (!['16:9', '9:16'].includes(aspectRatio)) {
    return { success: false, error: "aspectRatio 只支持 '16:9' 或 '9:16'" }
  }

  // 判断是否有图生图输入（用户参考图 + 角色图）
  const hasImageInput = (referenceImage && typeof referenceImage === 'string' && referenceImage.trim().length > 0)
    || (Array.isArray(characterImages) && characterImages.length > 0 && characterImages.some((item: any) => {
      const url = typeof item === 'object' && item !== null && 'imageUrl' in item ? item.imageUrl : item
      return typeof url === 'string' && url.trim().length > 0
    }))

  // 构建 input_urls：有图生图输入时用 gpt-image-2-image-to-image，最多16张图
  let imageInputList: string[] = []
  if (referenceImage && typeof referenceImage === 'string' && referenceImage.trim().length > 0) {
    imageInputList.push(referenceImage)
  }
  if (Array.isArray(characterImages) && characterImages.length > 0) {
    const charUrls = characterImages
      .slice(0, 16)
      .map((item: any) => {
        if (typeof item === 'object' && item !== null && 'imageUrl' in item) {
          return item.imageUrl
        }
        return item as string
      })
      .filter((url: string) => typeof url === 'string' && url.trim().length > 0)
    imageInputList.push(...charUrls)
  }
  // 最多16张图（GPT Image 2 img2img 支持最多16张）
  imageInputList = imageInputList.slice(0, 16)

  // GPT Image 2 API 请求体
  const kieRequestBody: any = {
    // 有图生图输入时用 gpt-image-2-image-to-image，否则用 gpt-image-2-text-to-image
    model: hasImageInput ? "gpt-image-2-image-to-image" : "gpt-image-2-text-to-image",
    input: hasImageInput
      ? {
          prompt: storyboardPrompt,
          input_urls: imageInputList,
          aspect_ratio: aspectRatio,
          resolution: "2K",
        }
      : {
          prompt: storyboardPrompt,
          aspect_ratio: aspectRatio,
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
        taskType: 'generate_storyboard',
        pointsAmount: 1,
        pointsDeducted: false,
        status: 'pending',
        projectId: projectId || null,
        versionId: versionId || null,
        itemId: itemId || null,
        versionGroupId: versionGroupId || null,
        newVersionId: null,
      })
      console.log('[generate-storyboard-image] 任务映射已存储:', { taskId, userId, versionId, versionGroupId })
    } catch (error) {
      console.error('[generate-storyboard-image] 存储任务映射失败:', error)
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
        PointsAction.GENERATE_STORYBOARD
      )
      console.log(`[generate-storyboard-image] 轮询模式：用户 ${userId} 成功生成分镜图，扣除1积分`)
    } catch (deductError) {
      console.error('[generate-storyboard-image] 轮询模式扣除积分失败:', deductError)
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
    console.log('[generate-storyboard-image] rawBody:', rawText)

    let body: any = {}
    try {
      body = JSON.parse(rawText)
    } catch (e) {
      return NextResponse.json({ error: 'Invalid JSON body', details: String(e) }, { status: 400 })
    }

    // 检查是否是批量请求
    const isBatch = Array.isArray(body?.scenes) && body.scenes.length > 0

    // 计算需要扣除的积分数量（每个分镜图2积分）
    const storyboardCount = isBatch ? body.scenes.length : 1
    const requiredPoints = storyboardCount * 1

    // 检查积分是否足够（不扣除，只检查）
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
      const scenes = body.scenes
      console.log('[generate-storyboard-image] batch request:', { count: scenes.length })

      const results: any[] = []
      let successCount = 0

      for (const s of scenes) {
        const storyboardPrompt = s.storyboardPrompt || s.prompt || ''
        const sceneId = s.id || null
        const aspectRatio = s.aspectRatio || '16:9'
        const characterImages = s.characterImages || []
        const firstFramePrompt = s.firstFramePrompt
        const lastFramePrompt = s.lastFramePrompt
        const referenceImage = typeof s.referenceImage === 'string' ? s.referenceImage : undefined

        console.log('[generate-storyboard-image] processing scene:', {
          sceneId,
          promptLength: storyboardPrompt.length,
          aspectRatio,
          hasFirstLastFrame: !!(firstFramePrompt && lastFramePrompt),
          hasReferenceImage: !!referenceImage
        })

        if (!storyboardPrompt.trim()) {
          results.push({
            sceneId,
            error: 'Missing storyboardPrompt for this scene'
          })
          continue
        }

        const result = await generateSingleStoryboard(
          storyboardPrompt,
          aspectRatio,
          characterImages,
          undefined,
          session.user.id,
          body.projectId,
          sceneId,
          body.versionId,
          body.versionGroupId,
          { firstFramePrompt, lastFramePrompt, referenceImage }
        )

        if (result.success) {
          console.log('[generate-storyboard-image] scene generated:', { 
            sceneId, 
            requestId: result.requestId, 
            hasFirstFrame: !!result.images?.firstFrame,
            hasLastFrame: !!result.images?.lastFrame 
          })
          successCount++
        } else {
          console.error('[generate-storyboard-image] scene generation failed:', { sceneId, error: result.error })
        }

        results.push({
          sceneId,
          images: result.success ? result.images : undefined,
          requestId: result.requestId,
          requestIds: result.requestIds,
          error: result.error
        })
      }

      // 批量模式：积分扣除在 webhook 回调或轮询完成时进行
      // 这里不再扣除积分，因为任务可能还在处理中（webhook 模式）

      console.log('[generate-storyboard-image] batch complete:', { total: results.length, success: successCount })
      return NextResponse.json({ success: true, results })
    }

    // 单个请求模式
    const {
      storyboardPrompt,
      aspectRatio,
      resolution,
      characterImages,
      webhookUrl,
      projectId,
      itemId,
      versionId,
      versionGroupId,
      firstFramePrompt,
      lastFramePrompt,
      regenerateFrameType,
      referenceImage
    } = body
    console.log('[generate-storyboard-image] single request:', {
      promptLength: storyboardPrompt?.length,
      aspectRatio,
      resolution,
      hasWebhook: !!webhookUrl,
      projectId,
      versionId,
      versionGroupId,
      hasFirstLastFrame: !!(firstFramePrompt && lastFramePrompt),
      regenerateFrameType,
      hasReferenceImage: !!referenceImage
    })

    const result = await generateSingleStoryboard(
      storyboardPrompt,
      aspectRatio,
      characterImages,
      webhookUrl,
      session.user.id,
      projectId,
      itemId,
      versionId,
      versionGroupId,
      { firstFramePrompt, lastFramePrompt, regenerateFrameType, referenceImage }
    )

    if (!result.success) {
      console.error('[generate-storyboard-image] generation failed:', { error: result.error })
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    // 积分扣除逻辑：
    // - Webhook 模式：在 webhook 回调成功时扣除（已在 generateSingleStoryboard 中存储任务映射）
    // - 轮询模式：在 generateSingleStoryboard 中已完成扣除
    // 这里不再需要扣除积分

    console.log('[generate-storyboard-image] success:', { 
      requestId: result.requestId, 
      requestIds: result.requestIds,
      hasFirstFrame: !!result.images?.firstFrame,
      hasLastFrame: !!result.images?.lastFrame 
    })
    
    // 构建返回数据
    const responseData: any = {
      success: true,
      images: result.images,
      requestId: result.requestId
    }
    
    // 如果是首尾帧模式，也返回 requestIds
    if (result.requestIds && result.requestIds.length > 0) {
      responseData.requestIds = result.requestIds
    }
    
    return NextResponse.json(responseData)

  } catch (error) {
    console.error('[generate-storyboard-image] API error:', error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
