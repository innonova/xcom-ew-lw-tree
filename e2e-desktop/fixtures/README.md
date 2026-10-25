# Test fixtures

`localhost-test.crt` / `.key`: a self-signed certificate for 127.0.0.1, so
`updates.spec.ts` can serve its local trusted-updates over https (the format
names https download URLs only). It protects nothing and is not a secret; the
app trusts it only because that test launches Electron with
`--ignore-certificate-errors`.
