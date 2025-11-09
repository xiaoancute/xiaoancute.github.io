---
title: Firefly 一款清新美观的 Astro 博客主题模板
published: 2025-10-13
pinned: false
description: Firefly 是一款基于 Astro 框架开发的清新美观且现代化个人博客主题，专为技术爱好者和内容创作者设计。该主题融合了现代 Web 技术栈，提供了丰富的功能模块和高度可定制的界面，让您能够轻松打造出专业且美观的个人博客网站。
tags: [Markdown, Firefly, 博客, 主题, 模板, 开源]
category: 文章示例
draft: true
---

## 🌟 项目概述

**Firefly** 是一款基于 Astro 框架开发的清新美观且现代化个人博客主题，专为技术爱好者和内容创作者设计。该主题融合了现代 Web 技术栈，提供了丰富的功能模块和高度可定制的界面，让您能够轻松打造出专业且美观的个人博客网站。




**🖥️在线预览： [Firefly - Demo site](https://firefly.cuteleaf.cn/)**

**🏠我的博客： [https://blog.cuteleaf.cn](https://blog.cuteleaf.cn/)**

**📝Firefly使用文档： [https://docs-firefly.cuteleaf.cn](https://docs-firefly.cuteleaf.cn/)**

**⭐Firefly开源地址：https://github.com/CuteLeaf/Firefly** 

::github{repo="CuteLeaf/Firefly"}

<img src="/assets/images/firefly.png" />


## 🚀 技术架构

- **静态站点生成**: 基于 Astro ，提供极快的加载速度和优秀的 SEO 优化
- **TypeScript 支持**: 完整的类型安全，提升开发体验和代码质量
- **响应式设计**: 使用 Tailwind CSS 构建，完美适配桌面端和移动端
- **组件化开发**: 支持 Astro、Svelte 组件，灵活可扩展


## 🎨 界面与主题模块

- **主题色彩系统**: 0-360度色相调节、主题色固定、三种默认模式
- **背景壁纸系统**: Banner/覆盖双模式、响应式图片、图片定位、打字机效果
- **看板娘系统**: Spine/Live2D双引擎、交互功能、动画配置
- **字体系统**: 多字体支持、预加载优化、字体回退

## 🧭 导航与布局模块

- **导航栏配置**: 多级菜单、图标支持、预设/自定义链接
- **侧边栏系统**: 模块化组件、布局控制、响应式行为

## 📢 内容展示模块

- **公告系统**: 内容配置、交互功能、显示控制
- **友链系统**: 权重排序、启用控制、标签分类
- **留言板系统**: 评论系统集成、页面开关控制
- **赞助系统**: 多种支付方式、收款码展示、赞助者列表、文章内赞助按钮
- **广告系统**: 多种广告类型、配置选项、广告位管理
- **目录大纲**：移动端和桌面端均支持目录大纲，方便快速浏览
- **文章随机封面图系统**: 支持通过 API 获取随机封面图、多 API 重试机制、自动降级到备用图片

## 🎛️ 高级配置模块

- **特效系统**: 樱花特效、动画参数、循环控制
- **统计系统**: 文章访问量统计、独立开关控制
- **开发工具**: 代码高亮、主题支持、插件支持
- **许可证系统**: 许可证显示、链接配置、开关控制
- **SEO优化**: OpenGraph、站点信息、关键词、语言设置

## ⚙️ 配置系统详解

- **模块化配置**: 每个功能模块都有独立的配置文件，便于管理和维护
- **站点配置**：网站基础信息、主题色彩、图标、语言设置
- **用户资料配置**：头像、姓名、简介、社交链接
- **功能配置**：评论系统、公告、许可证、页脚、统计、页面开关
- **样式配置**：代码高亮、樱花特效、字体管理
- **布局配置**：侧边栏、导航栏组件管理
- **组件配置**：音乐播放器、看板娘、广告、友链、赞助
- **页脚HTML**：自定义HTML内容注入


## 📖 配置说明

> 📚 **详细配置文档**: 查看 [Firefly使用文档](https://docs-firefly.cuteleaf.cn/) 获取完整的配置指南

### 配置文件结构

```
src/
├── config/
│   ├── index.ts              # 配置索引文件
│   ├── siteConfig.ts         # 站点基础配置
│   ├── profileConfig.ts      # 用户资料配置
│   ├── commentConfig.ts      # 评论系统配置
│   ├── announcementConfig.ts # 公告配置
│   ├── licenseConfig.ts      # 许可证配置
│   ├── footerConfig.ts       # 页脚配置
│   ├── FooterConfig.html     # 页脚HTML内容
│   ├── expressiveCodeConfig.ts # 代码高亮配置
│   ├── sakuraConfig.ts       # 樱花特效配置
│   ├── fontConfig.ts         # 字体配置
│   ├── sidebarConfig.ts      # 侧边栏布局配置
│   ├── navBarConfig.ts       # 导航栏配置
│   ├── musicConfig.ts        # 音乐播放器配置
│   ├── pioConfig.ts          # 看板娘配置
│   ├── adConfig.ts           # 广告配置
│   ├── friendsConfig.ts      # 友链配置
│   ├── sponsorConfig.ts      # 赞助配置
│   └── coverImageConfig.ts  # 文章随机封面图配置
```
