import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { Defaults, findCommand, pressAsks, readContracts, type InstalledExtension } from "../src/contract";

const ext = (id: string, packageJSON: InstalledExtension["packageJSON"]): InstalledExtension => ({ id, packageJSON });

describe("contracts", () => {
  it("uses EDGEguide's default for an EDGE extension without its own key, keeping what it contributes", () => {
    const [c] = readContracts([
      ext("edgemodders.edgedeck", {
        version: "1.0.0",
        contributes: { views: { edgedeck: [{ id: "edgedeck.mods" }] }, commands: [{ command: "edgedeck.deploy" }] },
      }),
    ]);
    assert.equal(c.source, "EDGEguide's default");
    assert.deepEqual(c.views, ["edgedeck.mods"]);
    assert.deepEqual(Object.keys(c.commands), ["edgedeck.deploy"]);
    assert.equal(c.commands["edgedeck.deploy"].changes, true);
    assert.ok(c.dropped.some((d) => d.startsWith("command edgedeck.openPage")));
  });

  it("an extension's own key replaces the default, and cannot list commands it does not contribute", () => {
    const [c] = readContracts([
      ext("edgemodders.edgedeck", {
        edgeguide: {
          views: ["edgedeck.mods", "workbench.view.explorer"],
          reveal: "edgedeck.edgeguide.reveal",
          commands: { "edgedeck.openPage": { changes: false }, "edgedeck.deploy": { hint: "x" }, "workbench.action.terminal.sendSequence": { changes: false } },
        },
        contributes: { views: { edgedeck: [{ id: "edgedeck.mods" }] }, commands: [{ command: "edgedeck.deploy" }, { command: "edgedeck.openPage" }] },
      }),
    ]);
    assert.equal(c.source, "own");
    assert.deepEqual(c.views, ["edgedeck.mods"]);
    assert.deepEqual(c.commands, { "edgedeck.openPage": { changes: false }, "edgedeck.deploy": { changes: true, hint: "x" } });
    assert.equal(c.reveal, undefined, "a reveal command it does not contribute is dropped");
    assert.equal(c.dropped.length, 3);
  });

  it("an extension EDGEguide has no default for and no key is left out", () => {
    assert.deepEqual(readContracts([ext("someone.else", { contributes: { commands: [{ command: "x" }] } })]), []);
  });

  it("findCommand finds the owner", () => {
    const cs = readContracts([ext("edgemodders.edgedeck", { contributes: { commands: [{ command: "edgedeck.undo" }] } })]);
    assert.equal(findCommand(cs, "edgedeck.undo")?.contract.extension, "edgemodders.edgedeck");
    assert.equal(findCommand(cs, "edgedeck.deploy"), undefined);
  });

  it("a default takes every command in its views' title bars and ... menus, as changes, and not an own key's", () => {
    const menus = {
      "view/title": [
        { command: "edgedeck.saveLoadout", when: "view == edgedeck.mods", group: "3_loadouts@1" },
        { command: "edgedeck.loadLoadout", when: "view == edgedeck.mods", group: "3_loadouts@0" },
        { command: "edgedeck.loadLoadout", when: "view == edgedeck.mods", group: "navigation@4" },
        { command: "other.thing", when: "view == other.view", group: "navigation" },
        { command: "edgedeck.notContributed", when: "view == edgedeck.mods", group: "1_more" },
      ],
    };
    const contributes = {
      views: { edgedeck: [{ id: "edgedeck.mods", name: "Mods" }] },
      commands: [
        { command: "edgedeck.saveLoadout", title: "Save as new loadout..." },
        { command: "edgedeck.loadLoadout", title: "Switch loadout...", icon: "$(layers)" },
        { command: "other.thing" },
      ],
      menus,
    };
    const [c] = readContracts([ext("edgemodders.edgedeck", { contributes })]);
    assert.deepEqual(Object.keys(c.commands).sort(), ["edgedeck.loadLoadout", "edgedeck.saveLoadout"]);
    assert.equal(c.commands["edgedeck.saveLoadout"].changes, true, "not described: counts as a change");
    assert.deepEqual(c.buttons["edgedeck.saveLoadout"], { title: "Save as new loadout...", place: "the ... menu at the top of the Mods view", menu: "view/title", view: "edgedeck.mods" });
    assert.equal(c.buttons["edgedeck.loadLoadout"].place, "the layers button at the top of the Mods view", "on the bar and in the menu: pointed at on the bar");
    const [own] = readContracts([ext("edgemodders.edgedeck", { edgeguide: { views: ["edgedeck.mods"], commands: {} }, contributes })]);
    assert.deepEqual(own.commands, {}, "an own key says what it lists");
  });

  it("pressing a step's button asks first when it may change things, unless it asks for more itself", () => {
    assert.equal(pressAsks({ changes: true }, "Deploy"), true);
    assert.equal(pressAsks({ changes: true }, "Save as new loadout..."), false);
    assert.equal(pressAsks({ changes: true }, "Move library…"), false);
    assert.equal(pressAsks({ changes: false }, "Show conflicts"), false);
  });

  it("every default command has a hint", () => {
    for (const c of Object.values(Defaults)) for (const [id, r] of Object.entries(c.commands)) assert.ok(r.hint, id);
  });
});
