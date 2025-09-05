/** @type {import('next').NextConfig} */
const isPages = process.env.GITHUB_PAGES === "true";
const repo = process.env.GITHUB_REPOSITORY?.split("/")[1] || "";

module.exports = {
  output: "export",           // <- makes `next build` write ./out
  images: { unoptimized: true },
  trailingSlash: true,
  ...(isPages && repo ? { basePath: `/${repo}`, assetPrefix: `/${repo}/` } : {}),
};
