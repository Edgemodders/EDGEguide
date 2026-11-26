// The contract with the EDGE extensions (design, "The contract with the EDGE extensions"): each one
// declares in its own package.json, under "edgeguide", the views EDGEguide may open and the
// commands it may run. Read from every installed extension's package.json, without starting it.
//
// Until an EDGE extension has its own key (G2), EDGEguide carries a starting one for it
// (Defaults below); the extension's own key replaces it whole. Either way an extension can only
// name views and commands it contributes itself, so another extension cannot put a command of
// VS Code's or anyone else's on the allow-list. No vscode import: the tests run it in plain Node.

export interface CommandRule {
  /** True when the command changes files or the game folder: ui_run asks first (it always does). */
  changes: boolean;
  /** A short note on what it does, for the assistant. */
  hint?: string;
}

export interface Contract {
  views: string[];
  reveal?: string;
  state?: string;
  commands: Record<string, CommandRule>;
}

export interface ExtensionContract extends Contract {
  extension: string;
  version: string;
  source: "own" | "EDGEguide's default";
  /** What was left out and why: a view or command the extension does not contribute. */
  dropped: string[];
}

/** What EDGEguide needs from an installed extension: vscode.Extension's id and packageJSON. */
export interface InstalledExtension {
  id: string;
  packageJSON: {
    version?: string;
    edgeguide?: unknown;
    contributes?: { views?: Record<string, { id: string }[]>; commands?: { command: string }[] | { command: string } };
  };
}

/**
 * Starting contracts, from each extension's package.json as of 2026-11-26 (EDGEdeck 0.34.2, REDcode
 * 0.10.17, EDGEwave 0.3.0). Only commands that work with no argument: a tree item's commands take
 * the item, so they wait for G2's reveal. Running the game counts as a change, so it asks.
 */
export const Defaults: Record<string, Contract> = {
  "edgemodders.edgedeck": {
    views: ["edgedeck.mods"],
    commands: {
      "edgedeck.openPage": { changes: false, hint: "Opens EDGEdeck's page: the mod list with details" },
      "edgedeck.checkConflicts": { changes: false, hint: "Shows which mods change the same files, and which one wins" },
      "edgedeck.showChanges": { changes: false, hint: "Shows what the next Deploy will change in the game folder" },
      "edgedeck.refresh": { changes: false, hint: "Reads the library again" },
      "edgedeck.deploy": { changes: true, hint: "Deploy: puts the mods that are on into the game folder" },
      "edgedeck.undo": { changes: true, hint: "Undo deploy: takes the last deploy out of the game folder" },
      "edgedeck.runGame": { changes: true, hint: "Starts Cyberpunk 2077" },
    },
  },
  "edgemodders.redcode-cyberpunk": {
    views: ["redcode.project", "redcode.assets", "redcode.library", "redcode.tweakdb", "redcode.lockeys"],
    commands: {
      "redcode.refreshProject": { changes: false, hint: "Reads the open project again" },
      "redcode.refreshAssets": { changes: false, hint: "Reads the game's files again in Game Assets" },
      "redcode.searchGameFiles": { changes: false, hint: "Asks for a name and searches the game's files" },
      "redcode.openTweakRecord": { changes: false, hint: "Asks for a TweakDB record and opens it" },
      "redcode.pack": { changes: true, hint: "Pack: builds the project's mod files" },
      "redcode.packAndInstall": { changes: true, hint: "Pack and Install: builds the project and installs it (through EDGEdeck when it is there)" },
      "redcode.packAndPlay": { changes: true, hint: "Pack and Play: builds the project and swaps it into the running game" },
      "redcode.install": { changes: true, hint: "Install: installs the last pack" },
      "redcode.uninstall": { changes: true, hint: "Uninstall: takes the project's mod out of the game" },
      "redcode.runGame": { changes: true, hint: "Starts Cyberpunk 2077" },
    },
  },
  "edgemodders.edgewave": {
    views: ["edgewave.sounds", "edgewave.project", "edgewave.library", "edgewave.gameAssets"],
    commands: {
      "edgewave.open": { changes: false, hint: "Asks for a sound and opens it in EDGEwave" },
      "edgewave.voiceLines": { changes: false, hint: "Opens the voice lines" },
      "edgewave.refreshSounds": { changes: false, hint: "Reads the sounds again" },
    },
  },
};

function contributed(ext: InstalledExtension) {
  const c = ext.packageJSON.contributes ?? {};
  const views = new Set(Object.values(c.views ?? {}).flat().map((v) => v.id));
  const list = Array.isArray(c.commands) ? c.commands : c.commands ? [c.commands] : [];
  const commands = new Set(list.map((x) => x.command));
  return { views, commands };
}

/** The extension's own "edgeguide" key, checked, or undefined when it has none or it is not usable. */
function own(raw: unknown): Contract | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const views = Array.isArray(r.views) ? r.views.filter((v): v is string => typeof v === "string") : [];
  const commands: Record<string, CommandRule> = {};
  if (r.commands && typeof r.commands === "object") {
    for (const [id, rule] of Object.entries(r.commands as Record<string, unknown>)) {
      const x = (rule ?? {}) as Record<string, unknown>;
      // Anything not plainly false counts as a change, so a mistake asks rather than not.
      commands[id] = { changes: x.changes !== false, ...(typeof x.hint === "string" ? { hint: x.hint.slice(0, 200) } : {}) };
    }
  }
  return {
    views,
    commands,
    ...(typeof r.reveal === "string" ? { reveal: r.reveal } : {}),
    ...(typeof r.state === "string" ? { state: r.state } : {}),
  };
}

/** The contracts of every installed extension that has one (its own, else EDGEguide's default). */
export function readContracts(extensions: readonly InstalledExtension[]): ExtensionContract[] {
  const out: ExtensionContract[] = [];
  for (const ext of extensions) {
    const mine = own(ext.packageJSON.edgeguide);
    const base = mine ?? Defaults[ext.id];
    if (!base) continue;
    const { views, commands } = contributed(ext);
    const dropped: string[] = [];
    const keepViews = base.views.filter((v) => views.has(v) || (dropped.push(`view ${v}: not contributed`), false));
    const keepCommands: Record<string, CommandRule> = {};
    for (const [id, rule] of Object.entries(base.commands)) {
      if (commands.has(id)) keepCommands[id] = rule;
      else dropped.push(`command ${id}: not contributed`);
    }
    const keepCommand = (id: string | undefined) => {
      if (!id) return undefined;
      if (commands.has(id)) return id;
      dropped.push(`command ${id}: not contributed`);
      return undefined;
    };
    const reveal = keepCommand(base.reveal);
    const state = keepCommand(base.state);
    out.push({
      extension: ext.id,
      version: ext.packageJSON.version ?? "",
      source: mine ? "own" : "EDGEguide's default",
      views: keepViews,
      commands: keepCommands,
      ...(reveal ? { reveal } : {}),
      ...(state ? { state } : {}),
      dropped,
    });
  }
  return out;
}

/** The command's rule and owner, or undefined when no contract lists it. */
export function findCommand(contracts: readonly ExtensionContract[], id: string): { contract: ExtensionContract; rule: CommandRule } | undefined {
  for (const contract of contracts) {
    const rule = contract.commands[id];
    if (rule) return { contract, rule };
  }
  return undefined;
}

/** The contract that lists the view, or undefined. */
export function findView(contracts: readonly ExtensionContract[], id: string): ExtensionContract | undefined {
  return contracts.find((c) => c.views.includes(id));
}
