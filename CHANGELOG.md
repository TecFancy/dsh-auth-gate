# Changelog

## [0.7.0](https://github.com/TecFancy/dsh-auth-gate/compare/v0.6.4...v0.7.0) (2026-08-19)


### Features

* **client:** move sign-out to the session header (top-right, icon-only) ([#37](https://github.com/TecFancy/dsh-auth-gate/issues/37)) ([613fd72](https://github.com/TecFancy/dsh-auth-gate/commit/613fd7250b086e11e05e889ac21e153e4fe5bd14))

## [0.6.4](https://github.com/TecFancy/dsh-auth-gate/compare/v0.6.3...v0.6.4) (2026-08-18)


### Bug Fixes

* **client:** use theme hover token for sign-out background ([dd01e11](https://github.com/TecFancy/dsh-auth-gate/commit/dd01e113acb41d3f3a72b2fb7867c014f995f15a))
* **client:** use theme hover token for sign-out background ([088119f](https://github.com/TecFancy/dsh-auth-gate/commit/088119f4802e2b6da657ff14c1843c836912ea3c))

## [0.6.3](https://github.com/TecFancy/dsh-auth-gate/compare/v0.6.2...v0.6.3) (2026-08-17)


### Bug Fixes

* **client:** match settings trigger width in wide state (calc +8px) ([dec24af](https://github.com/TecFancy/dsh-auth-gate/commit/dec24afef52e6d39e1b02e82a5070d048d1c9b25))
* match settings trigger width in wide state ([f4fccb0](https://github.com/TecFancy/dsh-auth-gate/commit/f4fccb08e83609010bb4fb2662f601f47134a76b))

## [0.6.2](https://github.com/TecFancy/dsh-auth-gate/compare/v0.6.1...v0.6.2) (2026-08-17)


### Bug Fixes

* align sign-out button styles with the settings trigger ([765577b](https://github.com/TecFancy/dsh-auth-gate/commit/765577bc46cad86e03f87e3241bcc6db3c784811))
* **client:** align sign-out button styles with the settings trigger ([600e200](https://github.com/TecFancy/dsh-auth-gate/commit/600e20035e45b7082b51ea129d0b5125fac1c16c))

## [0.6.1](https://github.com/TecFancy/dsh-auth-gate/compare/v0.6.0...v0.6.1) (2026-08-17)


### Bug Fixes

* **cli:** resolve symlinked entry before running ([68e0046](https://github.com/TecFancy/dsh-auth-gate/commit/68e004605dcaf708b6ba9f39214f2fe7091ef066))
* dsh-auth CLI entry check under symlinked installs ([f420f64](https://github.com/TecFancy/dsh-auth-gate/commit/f420f647c70d40b886f466f622e21f701f662bc5))

## [0.6.0](https://github.com/TecFancy/dsh-auth-gate/compare/v0.5.1...v0.6.0) (2026-08-17)


### Features

* **client:** add sign-out button to the sidebar foot ([a5bc397](https://github.com/TecFancy/dsh-auth-gate/commit/a5bc3971f39da93d29a6b898bc0c7c0e15254038))
* sign-out button in the GUI sidebar foot (client half) ([18347a7](https://github.com/TecFancy/dsh-auth-gate/commit/18347a79fa442762bebde2a347c9b1227390ffd4))

## [0.5.1](https://github.com/TecFancy/dsh-auth-gate/compare/v0.5.0...v0.5.1) (2026-08-17)


### Bug Fixes

* **login-page:** restore autofocus and raise contrast to WCAG AA ([9dd09de](https://github.com/TecFancy/dsh-auth-gate/commit/9dd09de95f6d4f923b15e83d2b61bf1871e6019d))

## [0.5.0](https://github.com/TecFancy/dsh-auth-gate/compare/v0.4.0...v0.5.0) (2026-08-15)


### Features

* declare dsh.bundle manifest for one-command mounting ([c6a08cd](https://github.com/TecFancy/dsh-auth-gate/commit/c6a08cdd6d9d2dfad9bf2b117f1839beb8b1992f))
* declare dsh.bundle manifest for one-command mounting ([3fa9c0f](https://github.com/TecFancy/dsh-auth-gate/commit/3fa9c0f5861be91e03bdcc4f3b43f93a37067665))

## [0.4.1](https://github.com/TecFancy/dsh-auth-gate/compare/v0.4.0...v0.4.1) (2026-08-15)


### Features

* declare `dsh.bundle` manifest so `dsh plugin add` registers the mount automatically (root [`cordis.patch.yml`](cordis.patch.yml); config overrides now live in the user patch layer, see `deploy/cordis.patch.yml`)

## [0.4.0](https://github.com/TecFancy/dsh-auth-gate/compare/v0.3.0...v0.4.0) (2026-08-15)


### Features

* align plugin name with package (dsh-auth-gate) ([ee3e436](https://github.com/TecFancy/dsh-auth-gate/commit/ee3e4368db4a1e5f36b3f7e1a33447340f3524b9))
* align plugin name with package (dsh-auth-gate) ([9d67d60](https://github.com/TecFancy/dsh-auth-gate/commit/9d67d608d59532857f8f8edeedbaae598f0bdea6))

## [0.3.0](https://github.com/TecFancy/dsh-auth-gate/compare/v0.2.0...v0.3.0) (2026-08-15)


### Features

* **package:** add npm keywords for discoverability ([00efe5f](https://github.com/TecFancy/dsh-auth-gate/commit/00efe5f4590ac8da9f65249703c400c3b22860bc))
* **package:** add npm keywords for discoverability ([479bb9d](https://github.com/TecFancy/dsh-auth-gate/commit/479bb9d79294aa5f7c7271c7abcd24214d7d78a7))

## [0.2.0](https://github.com/TecFancy/dsh-auth-gate/compare/v0.1.2...v0.2.0) (2026-08-15)


### Features

* **login-page:** redesign login page with modern card UI ([ec54466](https://github.com/TecFancy/dsh-auth-gate/commit/ec544660df8b3c733c566343bf949a607124a780))
* **login-page:** redesign login page with modern card UI ([edfe2d8](https://github.com/TecFancy/dsh-auth-gate/commit/edfe2d87c8d2759bab52e0497e98393dc0c0c6d6))

## [0.1.2](https://github.com/TecFancy/dsh-auth-gate/compare/v0.1.1...v0.1.2) (2026-08-15)


### Bug Fixes

* **ci:** pass release_created through job outputs so publish can run ([2af5e56](https://github.com/TecFancy/dsh-auth-gate/commit/2af5e563c66eb3d855604edf9973e8e2dd2d7062))
* **ci:** pass release_created through job outputs so publish can run ([a894966](https://github.com/TecFancy/dsh-auth-gate/commit/a894966bcca15852700b329cd8018716d0a8e36f))

## [0.1.1](https://github.com/TecFancy/dsh-auth-gate/compare/v0.1.0...v0.1.1) (2026-08-15)


### Bug Fixes

* **password-login:** clear failure buckets on successful login ([e41f8c7](https://github.com/TecFancy/dsh-auth-gate/commit/e41f8c7238bc3151b610e7c260dfe400aadccbb4))
* **password-login:** clear failure buckets on successful login + MIT license and metadata cleanup ([ec40f01](https://github.com/TecFancy/dsh-auth-gate/commit/ec40f0117345ae71a00c0f132a68142b7c4874d2))

## 0.1.0 (2026-08-15)


### Features

* implement M1 auth guard and persistent session store ([168b41e](https://github.com/TecFancy/dsh-auth/commit/168b41e145a9a737c48cf064530ad89ba88d23ba))
* **m2:** shared token gate with login page and bearer auth ([aee37b4](https://github.com/TecFancy/dsh-auth/commit/aee37b46162c446a2aa808294aa0c854f8ac23e3))
* **m3:** password login flow with scrypt users file rate limit and CLI ([db21eac](https://github.com/TecFancy/dsh-auth/commit/db21eac9ac30d5a2c1162b26d51597ac46db441d))
