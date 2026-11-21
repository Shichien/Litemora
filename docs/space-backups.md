# 用户空间备份与恢复

线上空间与原文件存放在 Cloudflare KV（`LITEMORA_SPACE_KV`），不依赖本地 `public/.dev-gallery`。当前写入不设置 TTL；发布站点时保留同一 KV 绑定即可继续使用原来的空间 URL。不要用本地演示种子覆盖其他用户的 profile、manifest、item、source 或 world-state。

## 创建只读备份

先运行 `npx wrangler whoami` 检查并刷新本机登录，或设置 `CLOUDFLARE_API_TOKEN`。脚本不会输出令牌，也不修改线上数据。

```powershell
node scripts/backup-space.mjs --space SPACE --account ACCOUNT_ID --namespace NAMESPACE_ID --output output/space-backups/SPACE-TIMESTAMP
```

脚本分页读取 `gallery:space:SPACE:` 和 `space:SPACE:` 两个前缀，保存全部原始字节（包括原理图、归属、公开性、ID/slug、世界配置、修改状态），生成：

- `restore-kv.json`：Wrangler bulk put 接受的 Base64 数据。
- `inventory.json`：每个 key 的字节数、SHA-256、原过期时间和备份时间。

输出目录必须是新的快照目录；脚本拒绝覆盖已有快照文件。备份可能含私有数据，只保存在被 Git 忽略的 `output/` 下，不放进 `public/` 或构建产物。应另外复制到自己的受控备份介质。备份不是自动容灾切换。

## 恢复

先核对目标 account/namespace、备份哈希及要恢复的 key；备份保留原用户归属、空间和作品标识，不能替换为管理员账号。仅在确认需要恢复时执行：

```powershell
npx wrangler kv bulk put output/space-backups/SPACE-TIMESTAMP/restore-kv.json --namespace-id NAMESPACE_ID --remote
```

这会覆盖同名 key，执行前应备份当前数据。恢复包不带过期时间，恢复后的记录不会因原 TTL 被自动删除。发现列表 `gallery:discover:public` 不属于单个用户空间，没有包含在恢复包中，避免恢复用户数据时覆盖全站其他作品；原始空间链接不依赖发现列表。

恢复后验证 `/api/gallery?space=SPACE`、作品详情、原文件下载以及 `/{space}/worlds/{slug}`。发现列表最多显示最近 24 项，作品没有出现在首页并不意味着已被删除。
