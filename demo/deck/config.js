// Edit this file to change names, links and evidence. index.html reads it on load.
window.DECK = {
  project: "Dewo",
  tagline: "The agent marketplace that only pays on proof.",
  event: "ETHGlobal Mumbai 2026",

  team: [
    { name: "Harshith Vellapha", role: "", handle: "@harshithv25" },
    { name: "Pal Patel", role: "", handle: "@palpatel224" },
    { name: "Mayank Tiwari", role: "", handle: "@M4yankkkk" },
    { name: "Yash Roshan", role: "", handle: "@rikodin3" },
    { name: "Sacheth Punna", role: "", handle: "@ksacheth" },
  ],

  links: [
    { label: "Code", href: "https://github.com/ksacheth/dewo" },
    { label: "Site", href: "https://dewo.vercel.app" },
  ],

  // Shown on the "On-chain today" slide. Empty href = shown as "pending".
  // The live run rows are from the end-to-end Mission in the README, recorded before ADR 0006 (sealed Course rules).
  evidence: [
    { what: "MissionEscrow, with Mission Limits", where: "Hedera testnet", value: "0x06ad…673e", href: "https://hashscan.io/testnet/contract/0x06adcb8415ab12423ed1cdfa2a691b3f704d673e" },
    { what: "x402 Replay payments, live run", where: "Hedera testnet", value: "0.0.7162784@1793980929.598978120", href: "https://hashscan.io/testnet/transaction/0.0.7162784@1793980929.598978120" },
    { what: "settle() of a live Mission", where: "Hedera testnet", value: "0x599b…c78d", href: "https://hashscan.io/testnet/transaction/0x599b7b6ec624b35e99751c2299cb68a38543cb56e61990c2f9b8e8ebcc8ec78d" },
    { what: "Episode submitted, 14 Decisions on 0G Compute", where: "0G Galileo", value: "0x40aa…635f", href: "https://chainscan-galileo.0g.ai/tx/0x40aac3b9dc6a531ea74f6950c7b41e75c08ce6fa68d9a89f8e63a345dae8635f" },
    { what: "Episode Log upload on the 0G Flow contract", where: "0G Galileo", value: "0xe6ec…58fc", href: "https://chainscan-galileo.0g.ai/tx/0xe6ecd506b8aae72e46ce9b38f0a1dd7112333721cdc008ede0b3d8eb993658fc" },
    { what: "EpisodeRegistry", where: "0G Galileo", value: "0xa4D1…78BA", href: "https://chainscan-galileo.0g.ai/address/0xa4D143e33a4db897C1861C4B7CB50946Aa5278BA" },
    { what: "Requester agent on the Mission Board", where: "Arkiv Rabdi", value: "0xc095…CA1d", href: "https://rabdi.explorer.arkiv.network/address/0xc0951010013c2aE3620931Fc2A407E94861dCA1d" },
  ],
};
