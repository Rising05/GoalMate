import {
  loginWithWechatCode,
  bindExistingAccount,
  registerNewAccount,
  setTokens,
  setApiBaseUrl,
  MiniProgramLoginResult,
} from "../../utils/api";

const app = getApp<IAppOption>();

Page({
  data: {
    step: "wechat-login" as "wechat-login" | "bind-or-register",
    tab: "bind" as "bind" | "register",
    bindToken: "",
    email: "",
    password: "",
    displayName: "",
    loading: false,
    error: "",
  },

  onLoad() {
    // Configure API base URL
    const baseUrl = wx.getStorageSync("apiBaseUrl") || "http://localhost:3000";
    setApiBaseUrl(baseUrl);

    // Check if already logged in
    if (app.globalData.isLoggedIn) {
      wx.switchTab({ url: "/pages/index/index" });
    }
  },

  onEmailInput(e: WechatMiniprogram.Input) {
    this.setData({ email: e.detail.value, error: "" });
  },

  onPasswordInput(e: WechatMiniprogram.Input) {
    this.setData({ password: e.detail.value, error: "" });
  },

  onDisplayNameInput(e: WechatMiniprogram.Input) {
    this.setData({ displayName: e.detail.value, error: "" });
  },

  switchTab(e: WechatMiniprogram.TouchEvent) {
    const tab = e.currentTarget.dataset.tab as "bind" | "register";
    this.setData({ tab, error: "" });
  },

  async handleWechatLogin() {
    this.setData({ loading: true, error: "" });
    try {
      // Step 1: Get WeChat login code
      const loginRes = await wxLogin();
      if (!loginRes.code) {
        throw new Error("微信授权失败，请重试");
      }

      // Step 2: Exchange code with backend
      const result: MiniProgramLoginResult = await loginWithWechatCode(loginRes.code);

      if (result.status === "AUTHENTICATED") {
        // Already bound — save tokens and go to main page
        setTokens(result.accessToken!, result.refreshToken!);
        app.globalData.isLoggedIn = true;
        wx.switchTab({ url: "/pages/index/index" });
      } else {
        // Needs binding
        this.setData({
          step: "bind-or-register",
          bindToken: result.bindToken!,
          loading: false,
        });
      }
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || "登录失败，请重试";
      this.setData({ error: msg, loading: false });
    }
  },

  async handleBindExisting() {
    const { bindToken, email, password } = this.data;
    if (!email || !password) {
      this.setData({ error: "请填写邮箱和密码" });
      return;
    }

    this.setData({ loading: true, error: "" });
    try {
      const result = await bindExistingAccount(bindToken, email, password);
      if (result.status === "AUTHENTICATED") {
        setTokens(result.accessToken!, result.refreshToken!);
        app.globalData.isLoggedIn = true;
        wx.switchTab({ url: "/pages/index/index" });
      }
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || "绑定失败，请重试";
      this.setData({ error: msg, loading: false });
    }
  },

  async handleRegister() {
    const { bindToken, email, password, displayName } = this.data;
    if (!email || !password) {
      this.setData({ error: "请填写邮箱和密码" });
      return;
    }
    if (password.length < 8) {
      this.setData({ error: "密码至少需要8位" });
      return;
    }

    this.setData({ loading: true, error: "" });
    try {
      const result = await registerNewAccount(
        bindToken,
        email,
        password,
        displayName || email.split("@")[0]
      );
      if (result.status === "AUTHENTICATED") {
        setTokens(result.accessToken!, result.refreshToken!);
        app.globalData.isLoggedIn = true;
        wx.switchTab({ url: "/pages/index/index" });
      }
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || "注册失败，请重试";
      this.setData({ error: msg, loading: false });
    }
  },
});

function wxLogin(): Promise<WechatMiniprogram.LoginSuccessCallbackResult> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: resolve,
      fail: reject,
    });
  });
}
