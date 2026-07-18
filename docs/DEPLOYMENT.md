# Ethereum Sepolia deployment

The live deployment uses a real Safe 1.5.0 proxy and the official NoxCompute contract on Ethereum Sepolia.
All assets are test-only and have no monetary value.

## Application

- Live frontend: https://web-three-inky-e6gbchzecf.vercel.app
- X demo video: https://x.com/AOMG123123/status/2078521165006655546
- Public repository: https://github.com/YingchenWang999/shadow-safe-payroll
- Network: Ethereum Sepolia (`11155111`)

## Contracts

- Safe: [`0x74a2...e0Cf`](https://sepolia.etherscan.io/address/0x74a2dDA776e3Fed3787C02B6f392810f164De0Cf)
- Demo ERC-7984 token: [`0x46Ad...1ce6`](https://sepolia.etherscan.io/address/0x46Ad489Db34b072A2Fe66f0e5Fa78cbA92ee1ce6)
- ShadowSafePayroll: [`0xE491...53a0`](https://sepolia.etherscan.io/address/0xE4910960aB70e6426F8D949b85311a550ce353a0)
- Official NoxCompute: [`0x24Ef...77bF`](https://sepolia.etherscan.io/address/0x24Ef36Ec5b626D7DCD09a98F3083c2758F0F77bF)

## Deployment and authorization evidence

- [Safe proxy creation](https://sepolia.etherscan.io/tx/0xc79c6a21d30ef5245c8acaeb799f3b91717e6b444af441e45d39e7dcad0f9919)
- [Demo ERC-7984 deployment](https://sepolia.etherscan.io/tx/0x3096b94355c1b2990490091e0e4f598f8a60b27b1b0f2d77d88a870b1f2fbabf)
- [Current payroll deployment](https://sepolia.etherscan.io/tx/0xb43a80eb284ad94730ac4be2144500453b371e3549d2c56df8ac9dfaf3fac951)
- [Old payroll operator revoked](https://sepolia.etherscan.io/tx/0x937b373d0c46907c3345d31da444791e2a12b42a357418e3f05547f6ea3ac547)
- [Current payroll operator authorized for 30 days](https://sepolia.etherscan.io/tx/0x78b3b916cb1cef2e8af374bfa48c1d063b350484aa0de03717184d9b6574fe36)

## Verified live payment

Payment `#1` completed with status `Claimed`. After the Safe's scoped viewer grant, the authorized test account
decrypted both the requested and settled handles as `1250` dcUSD.

- [Encrypted payment submitted](https://sepolia.etherscan.io/tx/0x1510656ae97b33813f23ab65d1ccc42ac1d2efe152bdad4a3c29ae1cafd49aa1)
- [Safe approval](https://sepolia.etherscan.io/tx/0x927283eb07f42bc8dc4998d8dea8548c7c72fd1a949cc4532059294f85beb09f)
- [Committed recipient claim](https://sepolia.etherscan.io/tx/0x26d15591d69cf5f51138721791dd4e82dd12ffa8d4abc7144fa74f7f173b7c55)
- [Safe auditor/viewer grant](https://sepolia.etherscan.io/tx/0xf17c227599fdbcc9959f5338c2da199b0dc6dd0ae5f127312c5bccb6725eaadf)

The salary value above is disclosed here only as test evidence. The transaction calldata and contract storage
contain Nox handles rather than that plaintext amount.
