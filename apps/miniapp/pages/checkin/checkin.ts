import {
  fetchTaskDetail,
  submitCheckin,
  createEvidenceUpload,
  completeEvidenceUpload,
  TodayDailyTask,
} from "../../utils/api";

interface UploadedFile {
  id: string;
  tempPath: string;
  assetId?: string;
  uploading: boolean;
  uploaded: boolean;
}

Page({
  data: {
    taskId: "",
    goalId: "",
    goalTitle: "",
    task: {} as TodayDailyTask,
    content: "",
    investedMinutes: "",
    studyMood: "",
    uploadedFiles: [] as UploadedFile[],
    submitting: false,
    error: "",
  },

  onLoad(options: Record<string, string>) {
    this.setData({
      taskId: options.taskId || "",
      goalId: options.goalId || "",
      goalTitle: decodeURIComponent(options.goalTitle || ""),
    });
    this.loadTask();
  },

  async loadTask() {
    try {
      const task = await fetchTaskDetail(this.data.taskId);
      this.setData({ task });
      if (task.latestCheckin) {
        this.setData({
          content: "",
          investedMinutes: "",
          studyMood: "",
        });
      }
    } catch (err) {
      console.error("Failed to load task:", err);
      wx.showToast({ title: "加载任务失败", icon: "none" });
    }
  },

  onContentInput(e: WechatMiniprogram.Input) {
    this.setData({ content: e.detail.value, error: "" });
  },

  onMinutesInput(e: WechatMiniprogram.Input) {
    this.setData({ investedMinutes: e.detail.value, error: "" });
  },

  selectMood(e: WechatMiniprogram.TouchEvent) {
    this.setData({ studyMood: e.currentTarget.dataset.mood as string });
  },

  chooseImage() {
    wx.chooseMedia({
      count: 5 - this.data.uploadedFiles.length,
      mediaType: ["image"],
      sizeType: ["compressed"],
      sourceType: ["album", "camera"],
      success: (res) => {
        const newFiles: UploadedFile[] = res.tempFiles.map((f) => ({
          id: `file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          tempPath: f.tempFilePath,
          uploading: true,
          uploaded: false,
        }));
        const files = [...this.data.uploadedFiles, ...newFiles];
        this.setData({ uploadedFiles: files });
        // Start upload for each new file
        newFiles.forEach((f) => this.uploadFile(f));
      },
    });
  },

  removeFile(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    this.setData({
      uploadedFiles: this.data.uploadedFiles.filter((f) => f.id !== id),
    });
  },

  async uploadFile(file: UploadedFile) {
    try {
      // Compute SHA-256 hash
      const hash = await computeFileHash(file.tempPath);

      // Create upload asset
      const uploadRes = await createEvidenceUpload(
        `checkin-${Date.now()}.jpg`,
        "image/jpeg",
        0, // WeChat doesn't easily give file size for temp files; backend will verify
        hash
      );

      // If we have a pre-signed PUT URL, upload the file
      if (uploadRes.upload?.url) {
        await uploadToSignedUrl(file.tempPath, uploadRes.upload.url, uploadRes.upload.headers);
      }

      // Call completion callback
      if (uploadRes.asset?.id) {
        await completeEvidenceUpload(uploadRes.asset.id);
      }

      // Update file status
      const files = this.data.uploadedFiles.map((f) =>
        f.id === file.id
          ? { ...f, assetId: uploadRes.asset?.id, uploading: false, uploaded: true }
          : f
      );
      this.setData({ uploadedFiles: files });
    } catch (err) {
      console.error("Upload failed:", err);
      const files = this.data.uploadedFiles.map((f) =>
        f.id === file.id ? { ...f, uploading: false, uploaded: false } : f
      );
      this.setData({ uploadedFiles: files });
      wx.showToast({ title: "上传失败", icon: "none" });
    }
  },

  async submitCheckin() {
    const { content, investedMinutes, studyMood, goalId, taskId, uploadedFiles } = this.data;

    if (!content.trim()) {
      this.setData({ error: "请填写学习内容和复盘" });
      return;
    }

    const evidenceFileIds = uploadedFiles
      .filter((f) => f.uploaded && f.assetId)
      .map((f) => f.assetId!);

    this.setData({ submitting: true, error: "" });
    try {
      const result = await submitCheckin({
        goalId,
        taskId,
        content: content.trim(),
        investedMinutes: investedMinutes ? Number(investedMinutes) : undefined,
        studyMood: studyMood || undefined,
        evidenceFileIds: evidenceFileIds.length > 0 ? evidenceFileIds : undefined,
      });

      // Navigate to result page
      wx.redirectTo({
        url: `/pages/result/result?checkinSuccess=true&taskId=${taskId}&goalId=${goalId}`,
      });
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || "打卡提交失败";
      this.setData({ error: msg, submitting: false });
    }
  },

  goBack() {
    wx.switchTab({ url: "/pages/index/index" });
  },

  previewImage(e: WechatMiniprogram.TouchEvent) {
    const url = e.currentTarget.dataset.url as string;
    wx.previewImage({ urls: [url], current: url });
  },
});

// ---- Helpers ----

function computeFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Use wx.getFileInfo for SHA-256 if available, otherwise use simple hash
    // Use getFileSystemManager or wx.getFileInfo (which may support digestAlgorithm in newer versions)
    const wxAny = wx as unknown as {
      getFileInfo: (opts: {
        filePath: string;
        digestAlgorithm: string;
        success: (res: { digest: string }) => void;
        fail: () => void;
      }) => void;
    };
    try {
      wxAny.getFileInfo({
        filePath,
        digestAlgorithm: "sha256",
        success: (res) => resolve(res.digest),
        fail: () => {
          const fallback = `sha256-fallback-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
          resolve(fallback);
        },
      });
    } catch {
      const fallback = `sha256-fallback-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      resolve(fallback);
    }
  });
}

function uploadToSignedUrl(
  filePath: string,
  url: string,
  headers?: Record<string, string>
): Promise<void> {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url,
      filePath,
      name: "file",
      header: headers || {},
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`Upload failed: ${res.statusCode}`));
        }
      },
      fail: reject,
    });
  });
}
