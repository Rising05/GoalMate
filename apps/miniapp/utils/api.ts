/**
 * GoalMate Mini Program API Client
 *
 * Communicates with the GoalMate NestJS API.
 * Handles auth token management, auto-refresh, and request/response typing.
 */

// ---- Configuration ----

let API_BASE_URL = "http://localhost:3000";

export function setApiBaseUrl(url: string): void {
  API_BASE_URL = url.replace(/\/$/, "");
}

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

// ---- Token management ----

let accessToken = "";
let refreshToken = "";

export function setTokens(access: string, refresh: string): void {
  accessToken = access;
  refreshToken = refresh;
  wx.setStorageSync("accessToken", access);
  wx.setStorageSync("refreshToken", refresh);
}

export function clearTokens(): void {
  accessToken = "";
  refreshToken = "";
  wx.removeStorageSync("accessToken");
  wx.removeStorageSync("refreshToken");
}

export function getAccessToken(): string {
  if (!accessToken) {
    accessToken = wx.getStorageSync("accessToken") || "";
  }
  return accessToken;
}

export function getRefreshToken(): string {
  if (!refreshToken) {
    refreshToken = wx.getStorageSync("refreshToken") || "";
  }
  return refreshToken;
}

// ---- HTTP helpers ----

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  data?: unknown;
  header?: Record<string, string>;
  skipAuth?: boolean;
}

interface ApiResponse<T = unknown> {
  status: number;
  data: T;
}

async function request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...options.header,
  };

  if (!options.skipAuth) {
    const token = getAccessToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  return new Promise<T>((resolve, reject) => {
    wx.request({
      url,
      method: (options.method || "GET") as WechatMiniprogram.RequestOption["method"],
      data: options.data as WechatMiniprogram.RequestOption["data"],
      header: headers,
      success(res: WechatMiniprogram.RequestSuccessCallbackResult) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data as T);
        } else if (res.statusCode === 401 && !options.skipAuth) {
          // Try token refresh
          tryRefreshAndRetry<T>(path, options).then(resolve).catch(reject);
        } else {
          const err = res.data as { message?: string; error?: string };
          reject({
            status: res.statusCode,
            message: err?.message || err?.error || `请求失败 (${res.statusCode})`,
          });
        }
      },
      fail(err: WechatMiniprogram.GeneralCallbackResult) {
        reject({ status: 0, message: err.errMsg || "网络请求失败" });
      },
    });
  });
}

let isRefreshing = false;
let refreshQueue: Array<{ resolve: (token: string) => void; reject: (err: unknown) => void }> = [];

async function tryRefreshAndRetry<T>(path: string, options: RequestOptions): Promise<T> {
  const rt = getRefreshToken();
  if (!rt) {
    clearTokens();
    throw { status: 401, message: "登录已过期，请重新登录" };
  }

  if (isRefreshing) {
    return new Promise<T>((resolve, reject) => {
      refreshQueue.push({
        resolve: async () => {
          try {
            resolve(await request<T>(path, options));
          } catch (e) {
            reject(e);
          }
        },
        reject,
      });
    });
  }

  isRefreshing = true;
  try {
    const result = await request<{ accessToken: string; refreshToken: string }>(
      "/auth/wechat-mini/refresh",
      { method: "POST", data: { refreshToken: rt }, skipAuth: true }
    );
    setTokens(result.accessToken, result.refreshToken);

    // Resolve queued requests
    for (const q of refreshQueue) {
      q.resolve(result.accessToken);
    }
    refreshQueue = [];

    return request<T>(path, options);
  } catch (err) {
    clearTokens();
    for (const q of refreshQueue) {
      q.reject(err);
    }
    refreshQueue = [];
    throw { status: 401, message: "登录已过期，请重新登录" };
  } finally {
    isRefreshing = false;
  }
}

// ---- Auth API ----

export interface MiniProgramLoginResult {
  status: "NEEDS_BINDING" | "AUTHENTICATED";
  bindToken?: string;
  expiresIn?: number;
  accessToken?: string;
  refreshToken?: string;
  user?: AuthUser;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  status: string;
  createdAt: string;
  membership: {
    plan: string;
    status: string;
    expiresAt: string | null;
  } | null;
  adminRole: string | null;
  adminPermissions: string[];
}

export async function loginWithWechatCode(code: string): Promise<MiniProgramLoginResult> {
  const deviceId = wx.getStorageSync("deviceId") || generateDeviceId();
  wx.setStorageSync("deviceId", deviceId);
  return request<MiniProgramLoginResult>("/auth/wechat-mini/login", {
    method: "POST",
    data: { code, deviceId },
    skipAuth: true,
  });
}

export async function bindExistingAccount(
  bindToken: string,
  email: string,
  password: string
): Promise<MiniProgramLoginResult> {
  const deviceId = wx.getStorageSync("deviceId") || generateDeviceId();
  return request<MiniProgramLoginResult>("/auth/wechat-mini/bind-existing", {
    method: "POST",
    data: {
      bindToken,
      email,
      password,
      deviceId,
    },
    skipAuth: true,
  });
}

export async function registerNewAccount(
  bindToken: string,
  email: string,
  password: string,
  displayName: string
): Promise<MiniProgramLoginResult> {
  const deviceId = wx.getStorageSync("deviceId") || generateDeviceId();
  return request<MiniProgramLoginResult>("/auth/wechat-mini/register", {
    method: "POST",
    data: {
      bindToken,
      email,
      password,
      displayName,
      deviceId,
    },
    skipAuth: true,
  });
}

export async function refreshSession(): Promise<{ accessToken: string; refreshToken: string }> {
  const rt = getRefreshToken();
  if (!rt) throw new Error("无 Refresh Token");
  return request("/auth/wechat-mini/refresh", {
    method: "POST",
    data: { refreshToken: rt },
    skipAuth: true,
  });
}

export async function logoutMiniProgram(): Promise<void> {
  const rt = getRefreshToken();
  if (rt) {
    try {
      await request("/auth/wechat-mini/logout", {
        method: "POST",
        data: { refreshToken: rt },
        skipAuth: true,
      });
    } catch {
      // Ignore errors on logout
    }
  }
  clearTokens();
}

export async function unbindWechat(): Promise<void> {
  return request("/auth/wechat-mini/binding", {
    method: "DELETE",
    data: { confirm: true },
  });
}

export async function fetchCurrentUser(): Promise<AuthUser> {
  return request<AuthUser>("/auth/me");
}

function generateDeviceId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "mp-";
  for (let i = 0; i < 16; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

// ---- Goal API ----

export interface Goal {
  id: string;
  title: string;
  description: string;
  category: string;
  status: string;
  startDate: string;
  endDate: string;
  toleranceDaysAllowed: number;
  toleranceDaysUsed: number;
  dailyTimeBudgetMinutes: number | null;
  examName: string | null;
  targetScore: string | null;
  currentScore: string | null;
  examDate: string | null;
  subjects: string[];
  materials: string[];
  chapters: string[];
  weaknesses: string[];
  studyDaysPerWeek: number | null;
  dailyStudyMinutes: number | null;
  mockExamFrequency: string | null;
  currentBaseline: string | null;
  constraints: string | null;
  finalReward: string | null;
}

export async function fetchGoals(): Promise<Goal[]> {
  return request<Goal[]>("/goals");
}

export async function fetchGoal(goalId: string): Promise<Goal> {
  return request<Goal>(`/goals/${goalId}`);
}

// ---- Daily Tasks API ----

export interface DailyTask {
  id: string;
  goalId: string;
  sourceDailyTaskId?: string | null;
  deviationEventId?: string | null;
  taskDate: string;
  date?: string;
  title: string;
  description: string;
  plannedMinutes: number | null;
  studyTaskType?: string | null;
  subject?: string | null;
  materialRef?: string | null;
  chapterRef?: string | null;
  questionCount?: number | null;
  targetAccuracy?: number | null;
  evidenceRequired?: boolean;
  priority?: number | null;
  estimatedMinutes?: number;
  taskType?: string;
  rescueReason?: string | null;
  rescueTriggerCode?: string | null;
  rescueRiskLevel?: "stable" | "warning" | "danger" | null;
  status: string;
}

export interface TodayDailyTask extends DailyTask {
  goalTitle: string;
  weeklyPlanId: string | null;
  weeklyPlanTitle: string | null;
  date: string;
  latestCheckin: TaskCheckin | null;
}

export async function fetchTodayTasks(goalId?: string): Promise<TodayDailyTask[]> {
  const query = goalId ? `?goalId=${encodeURIComponent(goalId)}` : "";
  return request<TodayDailyTask[]>(`/daily-tasks/today${query}`);
}

export async function fetchTaskDetail(taskId: string): Promise<TodayDailyTask> {
  return request<TodayDailyTask>(`/daily-tasks/${taskId}`);
}

// ---- Checkin API ----

export interface TaskCheckin {
  id: string;
  dailyTaskId: string | null;
  content: string;
  investedMinutes: number | null;
  completedSubtasks: string[];
  actualQuestionCount: number | null;
  correctQuestionCount: number | null;
  accuracy: number | null;
  evidenceFiles: EvidenceFile[];
  evidenceLinks: string[];
  studyMood: string | null;
  difficultyLevel: string | null;
  submittedAt: string;
  aiScore: {
    totalScore: number | null;
    analysisLevel: "BASIC" | "PRO";
    isDetailedAnalysisUnlocked: boolean;
    dimensions: Record<string, number> | null;
    evidence: Record<string, unknown> | null;
    summary: string | null;
    suggestion: string | null;
  } | null;
}

export type EvidenceFile =
  | string
  | {
      uploadId: string;
      name: string;
      mimeType: string;
      sizeBytes: number;
      checksumSha256: string | null;
      storageProvider: string;
      objectKey: string;
      url: string;
      status?: string;
      scanStatus?: string;
    };

export interface CheckinInput {
  goalId: string;
  taskId: string;
  content: string;
  investedMinutes?: number;
  completedSubtasks?: string[];
  actualQuestionCount?: number | null;
  correctQuestionCount?: number | null;
  studyMood?: string;
  difficultyLevel?: string;
  evidenceLinks?: string[];
  evidenceFileIds?: string[];
}

export async function submitCheckin(input: CheckinInput): Promise<{
  checkin: TaskCheckin;
  aiJob?: { jobId: string; status: string } | null;
}> {
  return request("/daily-tasks/checkin", {
    method: "POST",
    data: input,
  });
}

// ---- Upload API ----

export interface UploadAsset {
  id: string;
  userId: string;
  source: string;
  purpose: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string | null;
  storageProvider: string;
  objectKey: string;
  publicUrl: string | null;
  status: string;
  scanStatus: string;
  scanResult: string | null;
  uploadExpiresAt: string | null;
  scanAttempts: number;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface EvidenceUploadResponse {
  asset: UploadAsset;
  evidenceFile: Exclude<EvidenceFile, string>;
  upload?: { method: "PUT"; url: string; headers?: Record<string, string>; expiresAt: string } | null;
  download?: { method: "GET"; url: string; expiresAt: string } | null;
  queue?: { queued: boolean; queueName: string } | null;
}

/**
 * Create an evidence upload asset and get a pre-signed PUT URL for direct upload.
 */
export async function createEvidenceUpload(
  fileName: string,
  mimeType: string,
  sizeBytes: number,
  checksumSha256: string
): Promise<EvidenceUploadResponse> {
  return request<EvidenceUploadResponse>("/uploads/evidence", {
    method: "POST",
    data: { fileName, mimeType, sizeBytes, checksumSha256, source: "WECHAT_MINIPROGRAM" },
  });
}

/**
 * Call the completion callback after direct upload to trigger scan.
 */
export async function completeEvidenceUpload(assetId: string): Promise<UploadAsset> {
  return request<UploadAsset>(`/uploads/evidence/${assetId}/complete`, {
    method: "POST",
  });
}

/**
 * Poll upload asset status (for scan completion).
 */
export async function fetchUploadAsset(assetId: string): Promise<UploadAsset> {
  return request<UploadAsset>(`/uploads/evidence/${assetId}`);
}

// ---- Notification / Reminder API ----

export interface NotificationPreference {
  id: string;
  userId: string;
  enabled: boolean;
  reminderTime: string;
  timezone: string;
  channels: string[];
  reminderTypes: string[];
  silentDays: number[];
  examSprintDays: number;
  nextReminderAt: string | null;
  updatedAt: string;
}

export async function fetchNotificationPreference(): Promise<NotificationPreference> {
  return request<NotificationPreference>("/notifications/preferences");
}

export async function updateNotificationPreference(
  updates: Partial<Pick<NotificationPreference, "enabled" | "reminderTime" | "timezone" | "channels" | "reminderTypes" | "silentDays" | "examSprintDays">>
): Promise<NotificationPreference> {
  return request<NotificationPreference>("/notifications/preferences", {
    method: "PATCH",
    data: updates,
  });
}

// ---- WeChat Binding Status (for Web-bound users) ----

export interface WechatBindingStatus {
  bound: boolean;
  openIdPreview: string | null;
}

export async function fetchWechatBinding(): Promise<WechatBindingStatus> {
  return request<WechatBindingStatus>("/notifications/wechat-binding");
}
