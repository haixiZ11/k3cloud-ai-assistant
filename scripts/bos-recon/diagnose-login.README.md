# Login diagnostic safety

This script summarizes the existing local-account login flow. It does not fix
V9.1 authentication, implement FlatShake in the HTTP client, or establish that
issues #4 / #13 are resolved.

Set `K3_BASE_URL` explicitly. Run `pnpm tsx scripts/bos-recon/diagnose-login.ts`.
Without `K3_ACCT_ID`, it performs only unauthenticated catalog discovery and
prints the number of account sets. Names and identifiers are deliberately
omitted from shareable output; obtain the intended account ID from the BOS
client. It never selects the first account automatically.

With an explicit account ID present in that catalog and `K3_USERNAME` /
`K3_PASSWORD` supplied locally, it makes at most one authentication attempt.
The existing login function obtains the key, retains its cookies, and submits
the password in the same session. There is no second raw request or CAPTCHA
retry. A failed diagnostic is not a reason to repeat login automatically.

Output is one JSON summary containing fixed status labels, catalog count,
account-match boolean, observed key mode, and a bounded result code (unknown
codes become `other`). No response message/code text, URL, identity, password
length/ciphertext, key bytes, cookies, tokens/prefixes or exception text is
printed. RPC log writes are suppressed for this diagnostic session, including
transport and server failures. Other application/smoke-script logging is outside
this change. Exit code is 0 for discovery-only or accepted login, otherwise 1.

FlatShake remains a separate CLI helper. It requires an exact registered
version handler and rejects missing/invalid handlers; it never assumes a 2.6
algorithm is compatible with another negotiated version. CLI failures withhold
vendor exception details.

## Synthetic checks (no ERP required)

```sh
pnpm test -- tests/erp/diagnose-login.test.ts tests/erp/diagnose-login-cli.test.ts tests/erp/login-diagnostic-privacy.test.ts
dotnet run --project tests/erp/bridge/flatshake-safety/FlatShakeSafety.csproj --configuration Release
```

The TypeScript tests replace all fetch calls. CLI tests preload the synthetic
transport in the same Node process, use a temporary application directory and
assert that stdout/stderr contain no private details and no log files appear.
The C# checks compile the production helper against a synthetic vendor type;
they do not load installed Kingdee DLLs or validate real algorithm compatibility.
Never copy the synthetic assembly into a BOS installation.
