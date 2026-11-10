/**
 * 本地 dev mock 后端入口。
 *
 * 由 `vite.config.js` 的 `mock-backend-world-config` 插件在 `configureServer` /
 * `configurePreviewServer` 里调用, 把下面这些端点挂到 Vite 的 Connect 中间件栈上:
 *
 *   POST   /api/auth/github/exchange
 *   POST   /api/auth/google/exchange
 *   GET    /api/discover
 *   GET    /api/gallery
 *   GET    /api/gallery/item
 *   DELETE /api/gallery/item
 *   GET    /api/gallery/source
 *   POST   /api/gallery/items
 *   POST   /api/gallery/claim
 *   GET    /api/world-config
 *   POST   /api/world-config
 *   GET    /api/world-state
 *   POST   /api/world-state
 *   GET    /api/debug/world-state
 *
 * 顺序很重要: Connect 的 `middlewares.use(path)` 是**前缀匹配**,
 * 因此 `/api/gallery/item`、`/api/gallery/source`、`/api/gallery/items`、
 * `/api/gallery/claim` 必须注册在 `/api/gallery` 之前, 否则会被前缀路由先截获。
 */
import { registerAuthMockApi } from './auth.js'
import { registerDiscoverMockApi } from './discover.js'
import { registerGalleryMockApi } from './gallery.js'
import { registerWorldMockApi } from './world.js'

export function registerMockApi(middlewares) {
  registerAuthMockApi(middlewares)
  registerDiscoverMockApi(middlewares)
  registerGalleryMockApi(middlewares)
  registerWorldMockApi(middlewares)
}
