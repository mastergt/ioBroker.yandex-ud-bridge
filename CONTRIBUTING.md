# Contributing

Thanks for contributing to the Yandex Smart Home Bridge for ioBroker.

1. Open an Issue before making large changes.
2. Fork the repository and create a feature branch.
3. Keep changes focused, with corresponding unit tests.
4. Run `npm run check` and `npm test` locally.
5. Open a Pull Request describing what changed and how it was tested.

Please remove private IP addresses, device IDs, OAuth access tokens, refresh tokens, client secrets, passwords, URLs containing secrets, and exported backup files from logs and screenshots before posting them publicly. Use placeholders in configuration examples.

Core responsibilities:
- `main.js`: ioBroker lifecycle and adapter messages.
- `lib/`: provider API, OAuth, transformations and backup logic.
- `admin/`: editor and adapter Admin pages.
- `test/`: unit and regression tests.

The GitHub repository is community maintained; please be patient with review.
