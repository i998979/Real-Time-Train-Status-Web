const REDIRECT_URI = "https://real-time-train-status-web.pages.dev/auth/callback";
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

function base64url(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).split("=").join("").split("+").join("-").split("/").join("_");
}

function randomToken(size = 32) {
    const bytes = crypto.getRandomValues(new Uint8Array(size));
    return base64url(bytes);
}

function cookie(request, name) {
    const value = request.headers.get("Cookie") || "";
    const match = value.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]*)"));
    return match ? match[1] : null;
}

function cookieHeader(name, value, maxAge) {
    return `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

async function signingKey(secret) {
    return crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"]
    );
}

async function createSession(user, secret) {
    const payload = base64url(new TextEncoder().encode(JSON.stringify({
        sub: user.sub,
        email: user.email,
        exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE
    })));
    const key = await signingKey(secret);
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
    return payload + "." + base64url(new Uint8Array(signature));
}

async function validSession(request, secret) {
    try {
        const token = cookie(request, "site_session");
        if (!token || !secret) return false;

        const [payload, signature] = token.split(".");
        if (!payload || !signature) return false;

        const binary = atob(signature.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - signature.length % 4) % 4));
        const signatureBytes = Uint8Array.from(binary, c => c.charCodeAt(0));
        const key = await signingKey(secret);

        const valid = await crypto.subtle.verify(
            "HMAC",
            key,
            signatureBytes,
            new TextEncoder().encode(payload)
        );
        if (!valid) return false;

        const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - payload.length % 4) % 4));
        const session = JSON.parse(new TextDecoder().decode(Uint8Array.from(decoded, c => c.charCodeAt(0))));
        return Boolean(session.sub && session.exp > Date.now() / 1000);
    } catch {
        return false;
    }
}

function redirect(location, cookies = []) {
    const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
    for (const value of cookies) headers.append("Set-Cookie", value);
    return new Response(null, { status: 302, headers });
}

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;

    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.SESSION_SECRET) {
        return new Response("Authentication is not configured.", { status: 500 });
    }

    if (path === "/auth/google") {
        const state = randomToken();
        const verifier = randomToken(48);
        const challengeBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
        const challenge = base64url(new Uint8Array(challengeBytes));

        const googleUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        googleUrl.search = new URLSearchParams({
            client_id: env.GOOGLE_CLIENT_ID,
            redirect_uri: REDIRECT_URI,
            response_type: "code",
            scope: "openid email profile",
            state,
            code_challenge: challenge,
            code_challenge_method: "S256",
            prompt: "select_account"
        }).toString();

        return redirect(googleUrl.toString(), [
            cookieHeader("oauth_state", state, 600),
            cookieHeader("oauth_verifier", verifier, 600)
        ]);
    }

    if (path === "/auth/callback") {
        const state = url.searchParams.get("state");
        const code = url.searchParams.get("code");
        const savedState = cookie(request, "oauth_state");
        const verifier = cookie(request, "oauth_verifier");

        if (!code || !state || !savedState || state !== savedState || !verifier) {
            return new Response("Invalid login response. Please try again.", { status: 400 });
        }

        try {
            const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    code,
                    client_id: env.GOOGLE_CLIENT_ID,
                    client_secret: env.GOOGLE_CLIENT_SECRET,
                    redirect_uri: REDIRECT_URI,
                    grant_type: "authorization_code",
                    code_verifier: verifier
                })
            });

            if (!tokenResponse.ok) throw new Error("Token exchange failed");
            const tokens = await tokenResponse.json();

            const userResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
                headers: { Authorization: "Bearer " + tokens.access_token }
            });
            if (!userResponse.ok) throw new Error("User verification failed");

            const user = await userResponse.json();
            if (!user.sub || !user.email || user.email_verified !== true) {
                throw new Error("Google account is not verified");
            }

            const session = await createSession(user, env.SESSION_SECRET);
            return redirect("/", [
                cookieHeader("site_session", session, SESSION_MAX_AGE),
                cookieHeader("oauth_state", "", 0),
                cookieHeader("oauth_verifier", "", 0)
            ]);
        } catch {
            return new Response("Google login failed. Please try again.", { status: 401 });
        }
    }

    if (path === "/auth/logout") {
        return redirect("/", [cookieHeader("site_session", "", 0)]);
    }

    if (path === "/" || path === "/index.html") {
        if (!(await validSession(request, env.SESSION_SECRET))) {
            return redirect("/auth/google");
        }
    }

    return context.next();
}
