export * from "./dashboard-app"
export * from "./forms"
export * from "./links/utils"
// eslint-disable-next-line no-restricted-imports -- dashboard-app-local ./routes dir; no @ alias applies (false positive)
export * from "./routes/utils"

export {
  type DisplayModule,
  type FormModule,
  type MenuItemModule,
  type RouteModule,
  type WidgetModule,
} from "./types"
