const BLOCKED_PATHS = [
    /^\/server(?:\/|$)/,
    /^\/README\.md$/,
    /^\/WORK_LOG/i,
    /^\/wrangler\.toml$/,
    /^\/package(?:-lock)?\.json$/,
    /^\/\.gitignore$/
];

function isBlockedPath(pathname) {
    return BLOCKED_PATHS.some((pattern) => pattern.test(pathname));
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (isBlockedPath(url.pathname)) {
            return new Response("Not found", { status: 404 });
        }

        return env.ASSETS.fetch(request);
    }
};
