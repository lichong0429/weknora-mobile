// vite.config.js
import { defineConfig } from "file:///E:/24221/Documents/WorkBuddy/2026-08-19-22-50-17/weknora-mobile/node_modules/vite/dist/node/index.js";
import react from "file:///E:/24221/Documents/WorkBuddy/2026-08-19-22-50-17/weknora-mobile/node_modules/@vitejs/plugin-react/dist/index.js";
import { VitePWA } from "file:///E:/24221/Documents/WorkBuddy/2026-08-19-22-50-17/weknora-mobile/node_modules/vite-plugin-pwa/dist/index.js";
var vite_config_default = defineConfig({
  build: {
    // 在 WorkBuddy 环境中 Vite 默认清空 dist 会被安全删除 guard 拦截（>50 个文件），
    // 暂时禁用自动清空，需要干净构建时手动删除 dist 目录。
    emptyOutDir: false
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      manifest: {
        name: "WeKnora Mobile",
        short_name: "WeKnora",
        description: "Mobile-friendly client for WeKnora knowledge base",
        theme_color: "#2563eb",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable"
          },
          {
            src: "/icon-192x192.png",
            sizes: "192x192",
            type: "image/png"
          },
          {
            src: "/icon-512x512.png",
            sizes: "512x512",
            type: "image/png"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"]
      }
    })
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.WEKNORA_BASE || "http://localhost:8080",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, "/api")
      }
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJFOlxcXFwyNDIyMVxcXFxEb2N1bWVudHNcXFxcV29ya0J1ZGR5XFxcXDIwMjYtMDgtMTktMjItNTAtMTdcXFxcd2Vrbm9yYS1tb2JpbGVcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkU6XFxcXDI0MjIxXFxcXERvY3VtZW50c1xcXFxXb3JrQnVkZHlcXFxcMjAyNi0wOC0xOS0yMi01MC0xN1xcXFx3ZWtub3JhLW1vYmlsZVxcXFx2aXRlLmNvbmZpZy5qc1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vRTovMjQyMjEvRG9jdW1lbnRzL1dvcmtCdWRkeS8yMDI2LTA4LTE5LTIyLTUwLTE3L3dla25vcmEtbW9iaWxlL3ZpdGUuY29uZmlnLmpzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSc7XHJcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XHJcbmltcG9ydCB7IFZpdGVQV0EgfSBmcm9tICd2aXRlLXBsdWdpbi1wd2EnO1xyXG5cclxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcclxuICBidWlsZDoge1xyXG4gICAgLy8gXHU1NzI4IFdvcmtCdWRkeSBcdTczQUZcdTU4ODNcdTRFMkQgVml0ZSBcdTlFRDhcdThCQTRcdTZFMDVcdTdBN0EgZGlzdCBcdTRGMUFcdTg4QUJcdTVCODlcdTUxNjhcdTUyMjBcdTk2NjQgZ3VhcmQgXHU2MkU2XHU2MjJBXHVGRjA4PjUwIFx1NEUyQVx1NjU4N1x1NEVGNlx1RkYwOVx1RkYwQ1xyXG4gICAgLy8gXHU2NjgyXHU2NUY2XHU3OTgxXHU3NTI4XHU4MUVBXHU1MkE4XHU2RTA1XHU3QTdBXHVGRjBDXHU5NzAwXHU4OTgxXHU1RTcyXHU1MUMwXHU2Nzg0XHU1RUZBXHU2NUY2XHU2MjRCXHU1MkE4XHU1MjIwXHU5NjY0IGRpc3QgXHU3NkVFXHU1RjU1XHUzMDAyXHJcbiAgICBlbXB0eU91dERpcjogZmFsc2VcclxuICB9LFxyXG4gIHBsdWdpbnM6IFtcclxuICAgIHJlYWN0KCksXHJcbiAgICBWaXRlUFdBKHtcclxuICAgICAgcmVnaXN0ZXJUeXBlOiAnYXV0b1VwZGF0ZScsXHJcbiAgICAgIGluamVjdFJlZ2lzdGVyOiAnYXV0bycsXHJcbiAgICAgIG1hbmlmZXN0OiB7XHJcbiAgICAgICAgbmFtZTogJ1dlS25vcmEgTW9iaWxlJyxcclxuICAgICAgICBzaG9ydF9uYW1lOiAnV2VLbm9yYScsXHJcbiAgICAgICAgZGVzY3JpcHRpb246ICdNb2JpbGUtZnJpZW5kbHkgY2xpZW50IGZvciBXZUtub3JhIGtub3dsZWRnZSBiYXNlJyxcclxuICAgICAgICB0aGVtZV9jb2xvcjogJyMyNTYzZWInLFxyXG4gICAgICAgIGJhY2tncm91bmRfY29sb3I6ICcjZmZmZmZmJyxcclxuICAgICAgICBkaXNwbGF5OiAnc3RhbmRhbG9uZScsXHJcbiAgICAgICAgc3RhcnRfdXJsOiAnLycsXHJcbiAgICAgICAgaWNvbnM6IFtcclxuICAgICAgICAgIHtcclxuICAgICAgICAgICAgc3JjOiAnL2ljb24uc3ZnJyxcclxuICAgICAgICAgICAgc2l6ZXM6ICdhbnknLFxyXG4gICAgICAgICAgICB0eXBlOiAnaW1hZ2Uvc3ZnK3htbCcsXHJcbiAgICAgICAgICAgIHB1cnBvc2U6ICdhbnkgbWFza2FibGUnXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgICAge1xyXG4gICAgICAgICAgICBzcmM6ICcvaWNvbi0xOTJ4MTkyLnBuZycsXHJcbiAgICAgICAgICAgIHNpemVzOiAnMTkyeDE5MicsXHJcbiAgICAgICAgICAgIHR5cGU6ICdpbWFnZS9wbmcnXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgICAge1xyXG4gICAgICAgICAgICBzcmM6ICcvaWNvbi01MTJ4NTEyLnBuZycsXHJcbiAgICAgICAgICAgIHNpemVzOiAnNTEyeDUxMicsXHJcbiAgICAgICAgICAgIHR5cGU6ICdpbWFnZS9wbmcnXHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgXVxyXG4gICAgICB9LFxyXG4gICAgICB3b3JrYm94OiB7XHJcbiAgICAgICAgZ2xvYlBhdHRlcm5zOiBbJyoqLyoue2pzLGNzcyxodG1sLGljbyxwbmcsc3ZnLHdvZmYyfSddXHJcbiAgICAgIH1cclxuICAgIH0pXHJcbiAgXSxcclxuICBzZXJ2ZXI6IHtcclxuICAgIHBvcnQ6IDUxNzMsXHJcbiAgICBwcm94eToge1xyXG4gICAgICAnL2FwaSc6IHtcclxuICAgICAgICB0YXJnZXQ6IHByb2Nlc3MuZW52LldFS05PUkFfQkFTRSB8fCAnaHR0cDovL2xvY2FsaG9zdDo4MDgwJyxcclxuICAgICAgICBjaGFuZ2VPcmlnaW46IHRydWUsXHJcbiAgICAgICAgcmV3cml0ZTogKHBhdGgpID0+IHBhdGgucmVwbGFjZSgvXlxcL2FwaS8sICcvYXBpJylcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxufSk7XHJcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBMlgsU0FBUyxvQkFBb0I7QUFDeFosT0FBTyxXQUFXO0FBQ2xCLFNBQVMsZUFBZTtBQUV4QixJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUMxQixPQUFPO0FBQUE7QUFBQTtBQUFBLElBR0wsYUFBYTtBQUFBLEVBQ2Y7QUFBQSxFQUNBLFNBQVM7QUFBQSxJQUNQLE1BQU07QUFBQSxJQUNOLFFBQVE7QUFBQSxNQUNOLGNBQWM7QUFBQSxNQUNkLGdCQUFnQjtBQUFBLE1BQ2hCLFVBQVU7QUFBQSxRQUNSLE1BQU07QUFBQSxRQUNOLFlBQVk7QUFBQSxRQUNaLGFBQWE7QUFBQSxRQUNiLGFBQWE7QUFBQSxRQUNiLGtCQUFrQjtBQUFBLFFBQ2xCLFNBQVM7QUFBQSxRQUNULFdBQVc7QUFBQSxRQUNYLE9BQU87QUFBQSxVQUNMO0FBQUEsWUFDRSxLQUFLO0FBQUEsWUFDTCxPQUFPO0FBQUEsWUFDUCxNQUFNO0FBQUEsWUFDTixTQUFTO0FBQUEsVUFDWDtBQUFBLFVBQ0E7QUFBQSxZQUNFLEtBQUs7QUFBQSxZQUNMLE9BQU87QUFBQSxZQUNQLE1BQU07QUFBQSxVQUNSO0FBQUEsVUFDQTtBQUFBLFlBQ0UsS0FBSztBQUFBLFlBQ0wsT0FBTztBQUFBLFlBQ1AsTUFBTTtBQUFBLFVBQ1I7QUFBQSxRQUNGO0FBQUEsTUFDRjtBQUFBLE1BQ0EsU0FBUztBQUFBLFFBQ1AsY0FBYyxDQUFDLHNDQUFzQztBQUFBLE1BQ3ZEO0FBQUEsSUFDRixDQUFDO0FBQUEsRUFDSDtBQUFBLEVBQ0EsUUFBUTtBQUFBLElBQ04sTUFBTTtBQUFBLElBQ04sT0FBTztBQUFBLE1BQ0wsUUFBUTtBQUFBLFFBQ04sUUFBUSxRQUFRLElBQUksZ0JBQWdCO0FBQUEsUUFDcEMsY0FBYztBQUFBLFFBQ2QsU0FBUyxDQUFDLFNBQVMsS0FBSyxRQUFRLFVBQVUsTUFBTTtBQUFBLE1BQ2xEO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
