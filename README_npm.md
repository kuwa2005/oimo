# npm 配布について（この fork では未使用）

`kuwa2005/oimo` は **GitHub Releases のバイナリのみ**を公式配布とします。

上流の `@mimo-ai/cli` / `@mimo-ai/oimo-*` とは無関係です。`npm install -g @mimo-ai/cli` は Xiaomi 上流のパッケージを入れます。

インストール:

```bash
curl -fsSL https://raw.githubusercontent.com/kuwa2005/oimo/main/install | bash
```

```powershell
powershell -ep Bypass -c "irm https://raw.githubusercontent.com/kuwa2005/oimo/main/install.ps1 | iex"
```

リリース手順は [docs/RELEASING.md](./docs/RELEASING.md) を参照してください。
