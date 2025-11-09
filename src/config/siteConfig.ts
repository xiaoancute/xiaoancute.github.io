import type { SiteConfig } from "@/types/config";
import { fontConfig } from "./fontConfig";

// 定义站点语言
// 语言代码，例如：'zh_CN', 'zh_TW', 'en', 'ja', 'ru'。
const SITE_LANG = "zh_CN";

export const siteConfig: SiteConfig = {
  title: "XIAOAN",
  subtitle: "OvO",
  description: "欢迎~",
  keywords: [
    "Firefly",
    "Fuwari",
    "Astro",
    "ACGN",
    "博客",
    "技术博客",
    "静态博客",
    "xiaoan",
  ],

  lang: SITE_LANG,

  themeColor: {
    hue: 240, // 主题色的默认色相，范围从 0 到 360。例如：红色：0，青色：200，蓝绿色：250，粉色：345
    fixed: true, // 对访问者隐藏主题色选择器
    defaultMode: "system", // 默认模式："light" 亮色，"dark" 暗色，"system" 跟随系统
  },

  favicon: [
    // 留空以使用默认 favicon
    {
      src: "/assets/images/favicon.ico", // 图标文件路径
      theme: "light", // 可选，指定主题 'light' | 'dark'
      sizes: "32x32", // 可选，图标大小
    },
  ],

  // 导航栏Logo
  // navbarLogo 支持三种类型：Astro图标库，本地图片，网络图片
  // { type: "icon", value: "material-symbols:home-pin-outline" }
  // { type: "image", value: "/assets/images/logo.webp", alt: "Firefly Logo" }
  // { type: "image", value: "https://example.com/logo.png", alt: "Firefly Logo" }
  navbarLogo: {
    type: "image",
    value: "/assets/images/LiuYingPure3.svg",
    alt: "🍀",
  },
  navbarTitle: "Xiaoan", // 导航栏标题，可以设置为与 title 不同的值，如果不设置则使用 title

  // 追番配置
  bangumi: {
    userId: "1163581", // 在此处设置你的Bangumi用户ID
  },

  // 文章页底部的"上次编辑时间"卡片开关
  showLastModified: true,

  // OpenGraph图片功能,注意开启后要渲染很长时间，不建议本地调试的时候开启
  generateOgImages: false,

  // 页面开关配置 - 控制特定页面的访问权限，设为false会返回404
  pages: {
    anime: true, // 追番页面开关
    sponsor: true, // 赞助页面开关
    guestbook: true, // 留言板页面开关，需要配置评论系统
  },

  // 文章列表布局配置
  postListLayout: {
    // 默认布局模式："list" 列表模式（单列布局），"grid" 网格模式（双列布局）
    defaultMode: "list",
    // 是否允许用户切换布局
    allowSwitch: true,
  },

  // 分页配置
  pagination: {
    // 每页显示的文章数量
    postsPerPage: 10,
  },

  backgroundWallpaper: {
    // 壁纸模式："banner" 横幅壁纸，"overlay" 全屏壁纸，"none" 纯色背景无壁纸
    mode: "none",
    // 是否允许用户通过导航栏切换壁纸模式，设为false可提升性能（只渲染当前模式）
    switchable: false,

    // 背景图片配置
    src: {
      // 桌面背景图片
      desktop: "/assets/images/d1.webp",
      // 移动背景图片
      mobile: "/assets/images/m1.webp",
    },

    // Banner模式特有配置
    banner: {
      // 图片位置
      // 支持所有CSS object-position值，如: 'top', 'center', 'bottom', 'left top', 'right bottom', '25% 75%', '10px 20px'..
      // 如果不知道怎么配置百分百之类的配置，推荐直接使用：'center'居中，'top'顶部居中，'bottom' 底部居中，'left'左侧居中，'right'右侧居中
      position: "0% 20%",

      homeText: {
        // 主页显示自定义文本（全局开关）
        enable: true,
        // 主页横幅主标题
        title: "For You For Me For All Human",

        // 主页横幅副标题
        subtitle: [
          "想象力比知识更重要。",
          "不要害怕与众不同，害怕的是失去自己。",
          "真正的教育不是教你答案，而是教你如何思考。",
          "如果你想造一艘船，不要催人去砍木头，而是激发他们对海洋的渴望。",
          "权力导致腐败，绝对的权力导致绝对的腐败。",
          "人生不是寻找自我，而是创造自我。",
          "当我们不能回头时，我们唯一能做的就是继续前行。",
          "艺术家不是逃避现实的人，而是揭露现实的人。",
          "不要让噪音淹没了你内心的声音。",
          "技术本身并无善恶，关键在于使用它的人。",
          "如果道路平坦，那说明它不会通往高处。",
          "世界上只有一种真正的英雄主义，那就是看清生活的真相后依然热爱它。",
          "别让别人定义你的价值。",
          "你无法叫醒一个装睡的人。",
          "真正的自由是敢于直面自己的恐惧。",
          "伟大的思想总是遭遇平庸者的激烈反对。",
          "愚蠢的人相信命运，聪明的人创造命运。",
          "没有人能两次踏进同一条河流。",
          "所谓成熟，就是你仍然热爱生活，但不会再轻易相信它。",
          "人类的问题不在于机器，而在于使用机器的人。",
          "人要有点被误解的勇气。",
          "保持怀疑，但不要失去信仰。",
          "孤独不是脆弱，而是清醒的代价。",
          "如果你不发出自己的声音，别人就会替你说话。",
          "思考本身就是一种反叛。",
          "越是喧嚣的时代，越需要安静的头脑。",
          "勇敢不是没有恐惧，而是在恐惧中仍然行动。",
          "让世界变得更好的第一步，是让自己变得更清醒。",
          "我们终将成为自己曾经仰望的人。",
          "雄关漫道真如铁，而今迈步从头越",
        ],
        typewriter: {
          enable: true, // 启用副标题打字机效果
          speed: 100, // 打字速度（毫秒）
          deleteSpeed: 50, // 删除速度（毫秒）
          pauseTime: 2000, // 完全显示后的暂停时间（毫秒）
        },
      },
      credit: {
        enable: {
          desktop: false, // 桌面端显示横幅图片来源文本
          mobile: false, // 移动端显示横幅图片来源文本
        },
        text: {
          desktop: "Pixiv - 晚晚喵", // 桌面端要显示的来源文本
          mobile: "Mobile Credit", // 移动端要显示的来源文本
        },
        url: {
          desktop: "", // 桌面端原始艺术品或艺术家页面的 URL 链接
          mobile: "", // 移动端原始艺术品或艺术家页面的 URL 链接
        },
      },
      navbar: {
        transparentMode: "semifull", // 导航栏透明模式："semi" 半透明加圆角，"full" 完全透明，"semifull" 动态透明
      },
      // 波浪动画效果配置，开启可能会影响页面性能，请根据实际情况开启
      waves: {
        enable: {
          desktop: true, // 桌面端启用波浪动画效果
          mobile: true, // 移动端启用波浪动画效果
        },
        performance: {
          quality: "high",
          hardwareAcceleration: true, // 是否启用硬件加速
        },
        // 性能优化说明：
        // quality: "high" - 最佳视觉效果，但GPU占用较高，适合高性能设备
        // quality: "medium" - 平衡性能和质量，适合中等性能设备
        // quality: "low" - 最低GPU占用，动画更简单，适合低性能设备
        // hardwareAcceleration: true - 启用GPU加速，提升性能但增加GPU占用
        // hardwareAcceleration: false - 禁用GPU加速，降低GPU占用但可能影响性能
      },
    },

    // 全屏透明覆盖模式特有配置
    overlay: {
      zIndex: -1, // 层级，确保壁纸在背景层
      opacity: 0.8, // 壁纸透明度
      blur: 1, // 背景模糊程度
    },
  },

  // 目录功能
  toc: {
    // 目录功能开关
    enable: true,
    // 目录深度，1-3，1 表示只显示 h1 标题，2 表示显示 h1 和 h2 标题，依此类推
    // depth在新版已弃用
    depth: 3,
  },

  // 字体配置
  // 在src/config/fontConfig.ts中配置具体字体
  font: fontConfig,
};
