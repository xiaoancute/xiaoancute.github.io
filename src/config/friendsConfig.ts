import type { FriendLink } from "../types/config";

// 可以在src/content/spec/friends.md中编写友链页面下方的自定义内容

// 友链配置
export const friendsConfig: FriendLink[] = [
  {
    title: "夏夜流萤",
    imgurl:
      "https://q1.qlogo.cn/g?b=qq&nk=7618557&s=640",
    desc: "总有一场相遇，是互相喜欢的！",
    siteurl: "https://blog.cuteleaf.cn",
    tags: ["Blog"],
    weight: 10, // 权重，数字越大排序越靠前
    enabled: false, // 是否启用
  },
  {
    title: "Firefly Docs",
    imgurl: "https://docs-firefly.cuteleaf.cn/logo.png",
    desc: "Firefly主题模板文档",
    siteurl: "https://docs-firefly.cuteleaf.cn",
    tags: ["Docs"],
    weight: 9,
    enabled: false,
  },
  {
    title: "Firefly",
    imgurl: "https://docs-firefly.cuteleaf.cn/logo.png",
    desc: "Firefly 一款清新美观的 Astro 博客主题模板",
    siteurl: "https://github.com/CuteLeaf/Firefly",
    tags: ["GitHub", "Theme"],
    weight: 9,
    enabled: false,
  },
  {
    title: "Linuxdo",
    imgurl: "https://linux.do/uploads/default/optimized/4X/6/a/6/6a6affc7b1ce8140279e959d32671304db06d5ab_2_180x180.png",
    desc: "真诚、友善、团结、专业。",
    siteurl: "Linux.do",
    tags: ["Chinese forum"],
    weight: 10,
    enabled: true,
  },
];

// 获取启用的友链并按权重排序
export const getEnabledFriends = (): FriendLink[] => {
  return friendsConfig
    .filter((friend) => friend.enabled)
    .sort((a, b) => b.weight - a.weight); // 按权重降序排序
};
