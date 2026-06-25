/// <reference types="miniprogram-api-typings" />

declare namespace WechatMiniprogram {
  interface IAppOption {
    globalData: {
      accessToken: string;
      refreshToken: string;
      userInfo: WechatMiniprogram.UserInfo | null;
      isLoggedIn: boolean;
    };
  }
}
