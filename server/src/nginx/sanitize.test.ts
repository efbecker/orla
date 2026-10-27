import { describe, expect, it } from "vitest";
import { ConfigValidationError } from "./errors.js";
import {
  sanitizeCustomDirectives,
  sanitizeDomain,
  sanitizeHeaderName,
  sanitizeHeaderValue,
  sanitizeIpOrCidr,
  sanitizePath,
  sanitizeRegex,
  sanitizeUpstreamAddress,
  sanitizeUrl,
  wildcardToRegex,
} from "./sanitize.js";

const injections = [
  "example.com; include /etc/passwd",
  "example.com\nserver { }",
  "a.com}",
  "a.com{",
  "$host",
  'a"b.com',
];

describe("sanitizeDomain", () => {
  it("normalizes valid names", () => {
    expect(sanitizeDomain("Example.COM.")).toBe("example.com");
    expect(sanitizeDomain("*.example.com")).toBe("*.example.com");
    expect(sanitizeDomain("açaí.com.br")).toBe("xn--aa-4iaz.com.br");
  });

  it.each(injections)("rejects injection %j", (value) => {
    expect(() => sanitizeDomain(value)).toThrow(ConfigValidationError);
  });

  it("rejects malformed wildcards", () => {
    expect(() => sanitizeDomain("foo.*.com")).toThrow(ConfigValidationError);
    expect(() => sanitizeDomain("*.com")).toThrow(ConfigValidationError);
  });
});

describe("sanitizeUpstreamAddress / sanitizeIpOrCidr", () => {
  it("accepts hosts and IPs", () => {
    expect(sanitizeUpstreamAddress("10.0.0.5")).toBe("10.0.0.5");
    expect(sanitizeUpstreamAddress("[2001:db8::1]")).toBe("2001:db8::1");
    expect(sanitizeUpstreamAddress("app.internal")).toBe("app.internal");
  });

  it("rejects injection", () => {
    expect(() => sanitizeUpstreamAddress("10.0.0.1; deny all")).toThrow(ConfigValidationError);
    expect(() => sanitizeUpstreamAddress("*.internal")).toThrow(ConfigValidationError);
  });

  it("validates CIDR prefixes", () => {
    expect(sanitizeIpOrCidr("10.0.0.0/08")).toBe("10.0.0.0/8");
    expect(sanitizeIpOrCidr("2001:DB8::/32")).toBe("2001:db8::/32");
    expect(() => sanitizeIpOrCidr("10.0.0.0/33")).toThrow(ConfigValidationError);
    expect(() => sanitizeIpOrCidr("10.0.0.1;")).toThrow(ConfigValidationError);
  });
});

describe("paths and regexes", () => {
  it("accepts plain paths and rejects metacharacters", () => {
    expect(sanitizePath("/api/v1/")).toBe("/api/v1/");
    for (const bad of ["api", "/a b", "/a;b", "/a{b", "/$uri", "/a\nb", '/a"b']) {
      expect(() => sanitizePath(bad)).toThrow(ConfigValidationError);
    }
  });

  it("allows $ only as an end anchor", () => {
    expect(sanitizeRegex("^/img/.*\\.(png|jpg)$")).toBe("^/img/.*\\.(png|jpg)$");
    expect(sanitizeRegex("^/(a|b)$|^/c$")).toBe("^/(a|b)$|^/c$");
    expect(() => sanitizeRegex("^/$host")).toThrow(ConfigValidationError);
    expect(() => sanitizeRegex('^/a"')).toThrow(ConfigValidationError);
    expect(() => sanitizeRegex("^/(unclosed")).toThrow(ConfigValidationError);
  });

  it("converts globs to anchored regexes", () => {
    expect(wildcardToRegex("/blog/*/edit")).toBe("^\\/blog\\/(.*)\\/edit$");
  });
});

describe("headers", () => {
  it("validates names", () => {
    expect(sanitizeHeaderName("X-Custom", "REQUEST")).toBe("X-Custom");
    expect(() => sanitizeHeaderName("X Bad", "RESPONSE")).toThrow(ConfigValidationError);
    expect(() => sanitizeHeaderName("Connection", "REQUEST")).toThrow(ConfigValidationError);
  });

  it("allows CSP punctuation but not interpolation or quotes", () => {
    expect(sanitizeHeaderValue("default-src 'self'; img-src *")).toBe("default-src 'self'; img-src *");
    expect(() => sanitizeHeaderValue("$http_cookie")).toThrow(ConfigValidationError);
    expect(() => sanitizeHeaderValue('a"; add_header X 1')).toThrow(ConfigValidationError);
    expect(() => sanitizeHeaderValue("a\nb")).toThrow(ConfigValidationError);
  });
});

describe("sanitizeUrl", () => {
  it("accepts http(s) URLs", () => {
    expect(sanitizeUrl("https://new.example.com/path?x=1")).toBe("https://new.example.com/path?x=1");
  });

  it("only allows capture references when enabled", () => {
    expect(sanitizeUrl("https://a.com/$1", { allowCaptures: true })).toBe("https://a.com/$1");
    expect(() => sanitizeUrl("https://a.com/$1")).toThrow(ConfigValidationError);
    expect(() => sanitizeUrl("https://a.com/$host", { allowCaptures: true })).toThrow(ConfigValidationError);
  });

  it("rejects other schemes and injection", () => {
    expect(() => sanitizeUrl("javascript:alert(1)")).toThrow(ConfigValidationError);
    expect(() => sanitizeUrl('https://a.com/"; return 200')).toThrow(ConfigValidationError);
    expect(() => sanitizeUrl("https://a.com/{x}")).toThrow(ConfigValidationError);
  });
});

describe("sanitizeCustomDirectives", () => {
  it("accepts balanced blocks", () => {
    expect(sanitizeCustomDirectives('location /x { return 200 "}"; }')).toBe('location /x { return 200 "}"; }');
  });

  it("rejects text that escapes the enclosing block", () => {
    expect(() => sanitizeCustomDirectives("} server { listen 81; ")).toThrow(ConfigValidationError);
    expect(() => sanitizeCustomDirectives("location / {")).toThrow(ConfigValidationError);
  });
});
