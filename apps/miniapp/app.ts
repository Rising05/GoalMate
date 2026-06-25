/// <reference path="./typings/wechat.d.ts" />

interface IAppOption {
  globalData: {
    accessToken: string;
    refreshToken: string;
    userInfo: WechatMiniprogram.UserInfo | null;
    isLoggedIn: boolean;
  };
}

App<IAppOption>({
  globalData: {
    accessToken: "",
    refreshToken: "",
    userInfo: null,
    isLoggedIn: false,
  },

  onLaunch() {
    // Check stored session
    const accessToken = wx.getStorageSync("accessToken");
    const refreshToken = wx.getStorageSync("refreshToken");
    if (accessToken && refreshToken) {
      this.globalData.accessToken = accessToken;
      this.globalData.refreshToken = refreshToken;
      this.globalData.isLoggedIn = true;
    }
  },

  onShow() {
    // Re-check session validity on show
  },
});
