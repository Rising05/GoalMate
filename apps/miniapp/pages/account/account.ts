import {
  fetchCurrentUser,
  fetchNotificationPreference,
  updateNotificationPreference,
  unbindWechat,
  logoutMiniProgram,
  AuthUser,
  NotificationPreference,
} from "../../utils/api";

const app = getApp<IAppOption>();

Page({
  data: {
    user: {} as Partial<AuthUser>,
    membership: { plan: "FREE", status: "ACTIVE", expiresAt: null as string | null },
    quota: null as Record<string, { used: number; limit: number | null }> | null,
    wechatBound: true, // Mini program means bound
    reminderEnabled: false,
    reminderTime: "08:00",
    timezoneIndex: 0,
    timezones: ["Asia/Shanghai", "Asia/Tokyo", "Asia/Seoul", "America/New_York", "America/Los_Angeles", "Europe/London"],
    showUnbindConfirm: false,
    unbinding: false,
    loggingOut: false,
  },

  onShow() {
    if (!app.globalData.isLoggedIn) {
      wx.redirectTo({ url: "/pages/login/login" });
      return;
    }
    this.loadProfile();
    this.loadPreferences();
  },

  async loadProfile() {
    try {
      const user = await fetchCurrentUser();
      this.setData({
        user,
        membership: user.membership || { plan: "FREE", status: "ACTIVE", expiresAt: null },
        quota: ((user as unknown) as Record<string, unknown>).quota as Record<string, { used: number; limit: number | null }> | null,
      });
    } catch (err) {
      console.error("Failed to load profile:", err);
    }
  },

  async loadPreferences() {
    try {
      const prefs: NotificationPreference = await fetchNotificationPreference();
      const tzIndex = this.data.timezones.indexOf(prefs.timezone || "Asia/Shanghai");
      this.setData({
        reminderEnabled: prefs.enabled,
        reminderTime: prefs.reminderTime || "08:00",
        timezoneIndex: tzIndex >= 0 ? tzIndex : 0,
      });
    } catch (err) {
      console.error("Failed to load preferences:", err);
    }
  },

  async onReminderToggle(e: WechatMiniprogram.SwitchChange) {
    const enabled = e.detail.value;
    this.setData({ reminderEnabled: enabled });
    try {
      await updateNotificationPreference({ enabled });
    } catch (err) {
      console.error("Failed to update preferences:", err);
      this.setData({ reminderEnabled: !enabled });
    }
  },

  async onReminderTimeChange(e: WechatMiniprogram.PickerChange) {
    const time = e.detail.value as string;
    this.setData({ reminderTime: time });
    try {
      await updateNotificationPreference({ reminderTime: time });
    } catch (err) {
      console.error("Failed to update time:", err);
    }
  },

  async onTimezoneChange(e: WechatMiniprogram.PickerChange) {
    const index = Number(e.detail.value);
    this.setData({ timezoneIndex: index });
    try {
      await updateNotificationPreference({ timezone: this.data.timezones[index] });
    } catch (err) {
      console.error("Failed to update timezone:", err);
    }
  },

  handleUnbind() {
    this.setData({ showUnbindConfirm: true });
  },

  cancelUnbind() {
    this.setData({ showUnbindConfirm: false });
  },

  async confirmUnbind() {
    this.setData({ unbinding: true, showUnbindConfirm: false });
    try {
      await unbindWechat();
      wx.showToast({ title: "已解绑", icon: "success" });
      // After unbind, log out
      await logoutMiniProgram();
      app.globalData.isLoggedIn = false;
      wx.redirectTo({ url: "/pages/login/login" });
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || "解绑失败";
      wx.showToast({ title: msg, icon: "none" });
    } finally {
      this.setData({ unbinding: false });
    }
  },

  async handleLogout() {
    this.setData({ loggingOut: true });
    try {
      await logoutMiniProgram();
    } catch {
      // Ignore errors
    }
    app.globalData.isLoggedIn = false;
    wx.redirectTo({ url: "/pages/login/login" });
  },
});
