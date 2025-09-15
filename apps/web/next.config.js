/** @type {import('next').NextConfig} */
const nextConfig = {
    experimental: {
        esmExternals: "loose",
    },
    transpilePackages: [
        "@bufbuild/protobuf",
        "@connectrpc/connect",
        "@connectrpc/connect-web",
    ],
    webpack: (config) => {
        config.resolve.extensionAlias = {
            ".js": [".js", ".ts", ".tsx"],
            ".mjs": [".mjs", ".js"], // helps with ESM packages
        };

        // Add fallbacks for Node core modules (browser safe)
        config.resolve.fallback = {
            fs: false,
            path: false,
            os: false,
            crypto: false,
            stream: false,
            buffer: false,
        };

        return config;
    },
};

module.exports = nextConfig;
