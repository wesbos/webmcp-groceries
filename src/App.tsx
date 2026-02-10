import { useEffect, useReducer, useRef, type DragEvent, type FormEvent } from "react";
import "./App.css";

/* ------------------------------------------------------------------ */
/*  WebMCP type augmentations (experimental Chrome 146+ API)          */
/* ------------------------------------------------------------------ */
type ToolContent = { type: "text"; text: string };
type ToolResult = { content: ToolContent[] };

interface WebMCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, string>;
  execute: (args: Record<string, unknown>) => ToolResult;
}

interface ModelContext {
  registerTool(tool: WebMCPTool): void;
  unregisterTool(name: string): void;
  provideContext(ctx: { tools: WebMCPTool[] }): void;
  clearContext(): void;
}

declare global {
  interface SubmitEvent {
    agentInvoked?: boolean;
    respondWith?(promise: Promise<unknown>): void;
  }
  interface Navigator {
    modelContext?: ModelContext;
  }
}

declare module "react" {
  interface FormHTMLAttributes<T> {
    toolname?: string;
    tooldescription?: string;
    toolautosubmit?: boolean | "";
  }
  interface InputHTMLAttributes<T> {
    toolparamtitle?: string;
    toolparamdescription?: string;
  }
  interface SelectHTMLAttributes<T> {
    toolparamtitle?: string;
    toolparamdescription?: string;
  }
}

/* ------------------------------------------------------------------ */
/*  Data types                                                        */
/* ------------------------------------------------------------------ */
type GroceryItem = {
  id: string;
  name: string;
  purchased: boolean;
};

type Store = {
  id: string;
  name: string;
  items: GroceryItem[];
};

/* ------------------------------------------------------------------ */
/*  Reducer                                                           */
/* ------------------------------------------------------------------ */
type Action =
  | { type: "ADD_ITEM"; storeId: string; name: string }
  | { type: "DELETE_ITEM"; itemId: string }
  | { type: "TOGGLE_PURCHASED"; itemId: string }
  | { type: "MOVE_ITEM"; itemId: string; targetStoreId: string }
  | { type: "ADD_STORE"; name: string }
  | { type: "DELETE_STORE"; storeId: string };

function reducer(stores: Store[], action: Action): Store[] {
  switch (action.type) {
    case "ADD_ITEM":
      return stores.map((s) =>
        s.id === action.storeId
          ? {
              ...s,
              items: [
                ...s.items,
                {
                  id: crypto.randomUUID(),
                  name: action.name,
                  purchased: false,
                },
              ],
            }
          : s
      );

    case "DELETE_ITEM":
      return stores.map((s) => ({
        ...s,
        items: s.items.filter((i) => i.id !== action.itemId),
      }));

    case "TOGGLE_PURCHASED":
      return stores.map((s) => ({
        ...s,
        items: s.items.map((i) =>
          i.id === action.itemId ? { ...i, purchased: !i.purchased } : i
        ),
      }));

    case "MOVE_ITEM": {
      let movedItem: GroceryItem | undefined;
      const without = stores.map((s) => {
        const found = s.items.find((i) => i.id === action.itemId);
        if (found) movedItem = found;
        return { ...s, items: s.items.filter((i) => i.id !== action.itemId) };
      });
      if (!movedItem) return stores;
      return without.map((s) =>
        s.id === action.targetStoreId
          ? { ...s, items: [...s.items, movedItem!] }
          : s
      );
    }

    case "ADD_STORE":
      return [
        ...stores,
        { id: crypto.randomUUID(), name: action.name, items: [] },
      ];

    case "DELETE_STORE":
      return stores.filter((s) => s.id !== action.storeId);

    default:
      return stores;
  }
}

/* ------------------------------------------------------------------ */
/*  Initial data                                                      */
/* ------------------------------------------------------------------ */
const INITIAL_STORES: Store[] = [
  {
    id: crypto.randomUUID(),
    name: "Costco",
    items: [
      { id: crypto.randomUUID(), name: "Milk", purchased: false },
      { id: crypto.randomUUID(), name: "Eggs", purchased: false },
      { id: crypto.randomUUID(), name: "Bread", purchased: false },
    ],
  },
  {
    id: crypto.randomUUID(),
    name: "Whole Foods",
    items: [
      { id: crypto.randomUUID(), name: "Kale", purchased: true },
      { id: crypto.randomUUID(), name: "Avocados", purchased: false },
    ],
  },
  {
    id: crypto.randomUUID(),
    name: "Walmart",
    items: [
      { id: crypto.randomUUID(), name: "Paper Towels", purchased: false },
      { id: crypto.randomUUID(), name: "Batteries", purchased: false },
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */
function findItem(stores: Store[], itemId: string) {
  for (const store of stores) {
    const item = store.items.find((i) => i.id === itemId);
    if (item) return { store, item };
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/*  App                                                               */
/* ------------------------------------------------------------------ */
export default function App() {
  const [stores, dispatch] = useReducer(reducer, INITIAL_STORES);

  /* ---- Drag & Drop ---- */
  function handleDragStart(e: DragEvent, itemId: string) {
    e.dataTransfer.setData("text/plain", itemId);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function handleDrop(e: DragEvent, targetStoreId: string) {
    e.preventDefault();
    const itemId = e.dataTransfer.getData("text/plain");
    if (itemId) {
      dispatch({ type: "MOVE_ITEM", itemId, targetStoreId });
    }
  }

  /* ---- Imperative WebMCP query tools ---- */
  const storesRef = useRef(stores);
  storesRef.current = stores;

  useEffect(() => {
    const mc = navigator.modelContext;
    if (!mc) return;

    const queryTools: WebMCPTool[] = [
      {
        name: "get_stores",
        description:
          "Get a list of all stores in the grocery list with their IDs and item counts.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: "true" },
        execute: () => {
          const current = storesRef.current;
          const data = current.map((s) => ({
            id: s.id,
            name: s.name,
            itemCount: s.items.length,
            purchasedCount: s.items.filter((i) => i.purchased).length,
          }));
          return {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          };
        },
      },
      {
        name: "get_all_items",
        description:
          "Get every grocery item across all stores, including each item's ID, name, purchased status, and which store it belongs to.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: "true" },
        execute: () => {
          const current = storesRef.current;
          const data = current.flatMap((s) =>
            s.items.map((i) => ({
              id: i.id,
              name: i.name,
              purchased: i.purchased,
              storeId: s.id,
              storeName: s.name,
            }))
          );
          return {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          };
        },
      },
      {
        name: "get_items_by_store",
        description:
          "Get all grocery items for a specific store by store ID. Use get_stores first to find the store ID.",
        inputSchema: {
          type: "object",
          properties: {
            store_id: {
              type: "string",
              description: "The ID of the store to get items for",
            },
          },
          required: ["store_id"],
        },
        annotations: { readOnlyHint: "true" },
        execute: (args: Record<string, unknown>) => {
          const current = storesRef.current;
          const store = current.find((s) => s.id === args.store_id);
          if (!store) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: Store with id "${args.store_id}" not found.`,
                },
              ],
            };
          }
          const data = {
            storeId: store.id,
            storeName: store.name,
            items: store.items.map((i) => ({
              id: i.id,
              name: i.name,
              purchased: i.purchased,
            })),
          };
          return {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          };
        },
      },
    ];

    for (const tool of queryTools) {
      mc.registerTool(tool);
    }

    return () => {
      for (const tool of queryTools) {
        mc.unregisterTool(tool.name);
      }
    };
  }, []);

  /* ---- Per-column add-item handler ---- */
  function handleAddItemUI(e: FormEvent<HTMLFormElement>, storeId: string) {
    e.preventDefault();
    const form = e.currentTarget;
    const input = form.elements.namedItem("item_name") as HTMLInputElement;
    const name = input.value.trim();
    if (!name) return;
    dispatch({ type: "ADD_ITEM", storeId, name });
    input.value = "";
    input.focus();
  }

  /* ---- WebMCP form handlers ---- */
  function handleToolAddItem(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const native = e.nativeEvent as SubmitEvent;
    const fd = new FormData(e.currentTarget);
    const storeId = fd.get("store_id") as string;
    const name = (fd.get("item_name") as string)?.trim();
    if (!storeId || !name) {
      native.respondWith?.(
        Promise.resolve({
          content: [{ type: "text", text: "Error: store_id and item_name are required." }],
        })
      );
      return;
    }
    const store = stores.find((s) => s.id === storeId);
    if (!store) {
      native.respondWith?.(
        Promise.resolve({
          content: [{ type: "text", text: `Error: Store with id "${storeId}" not found.` }],
        })
      );
      return;
    }
    dispatch({ type: "ADD_ITEM", storeId, name });
    if (native.agentInvoked) {
      native.respondWith?.(
        Promise.resolve({
          content: [{ type: "text", text: `Added "${name}" to ${store.name}.` }],
        })
      );
    }
    // e.currentTarget.reset();
  }

  function handleToolDeleteItem(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const native = e.nativeEvent as SubmitEvent;
    const fd = new FormData(e.currentTarget);
    const itemId = fd.get("item_id") as string;
    const found = findItem(stores, itemId);
    if (!found) {
      native.respondWith?.(
        Promise.resolve({
          content: [{ type: "text", text: `Error: Item with id "${itemId}" not found.` }],
        })
      );
      return;
    }
    dispatch({ type: "DELETE_ITEM", itemId });
    if (native.agentInvoked) {
      native.respondWith?.(
        Promise.resolve({
          content: [
            {
              type: "text",
              text: `Deleted "${found.item.name}" from ${found.store.name}.`,
            },
          ],
        })
      );
    }
    // e.currentTarget.reset();
  }

  function handleToolTogglePurchased(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const native = e.nativeEvent as SubmitEvent;
    const fd = new FormData(e.currentTarget);
    const itemId = fd.get("item_id") as string;
    const found = findItem(stores, itemId);
    if (!found) {
      native.respondWith?.(
        Promise.resolve({
          content: [{ type: "text", text: `Error: Item with id "${itemId}" not found.` }],
        })
      );
      return;
    }
    dispatch({ type: "TOGGLE_PURCHASED", itemId });
    const newStatus = !found.item.purchased ? "purchased" : "not purchased";
    if (native.agentInvoked) {
      native.respondWith?.(
        Promise.resolve({
          content: [
            {
              type: "text",
              text: `Marked "${found.item.name}" as ${newStatus}.`,
            },
          ],
        })
      );
    }
    // e.currentTarget.reset();
  }

  function handleToolMoveItem(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const native = e.nativeEvent as SubmitEvent;
    const fd = new FormData(e.currentTarget);
    const itemId = fd.get("item_id") as string;
    const targetStoreId = fd.get("target_store_id") as string;
    const found = findItem(stores, itemId);
    const targetStore = stores.find((s) => s.id === targetStoreId);
    if (!found || !targetStore) {
      native.respondWith?.(
        Promise.resolve({
          content: [{ type: "text", text: "Error: Item or target store not found." }],
        })
      );
      return;
    }
    dispatch({ type: "MOVE_ITEM", itemId, targetStoreId });
    if (native.agentInvoked) {
      native.respondWith?.(
        Promise.resolve({
          content: [
            {
              type: "text",
              text: `Moved "${found.item.name}" from ${found.store.name} to ${targetStore.name}.`,
            },
          ],
        })
      );
    }
    // e.currentTarget.reset();
  }

  function handleToolAddStore(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const native = e.nativeEvent as SubmitEvent;
    const fd = new FormData(e.currentTarget);
    const name = (fd.get("store_name") as string)?.trim();
    if (!name) {
      native.respondWith?.(
        Promise.resolve({
          content: [{ type: "text", text: "Error: store_name is required." }],
        })
      );
      return;
    }
    dispatch({ type: "ADD_STORE", name });
    if (native.agentInvoked) {
      native.respondWith?.(
        Promise.resolve({
          content: [{ type: "text", text: `Created store "${name}".` }],
        })
      );
    }
    // e.currentTarget.reset();
  }

  function handleToolDeleteStore(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const native = e.nativeEvent as SubmitEvent;
    const fd = new FormData(e.currentTarget);
    const storeId = fd.get("store_id") as string;
    const store = stores.find((s) => s.id === storeId);
    if (!store) {
      native.respondWith?.(
        Promise.resolve({
          content: [{ type: "text", text: `Error: Store with id "${storeId}" not found.` }],
        })
      );
      return;
    }
    dispatch({ type: "DELETE_STORE", storeId });
    if (native.agentInvoked) {
      native.respondWith?.(
        Promise.resolve({
          content: [
            {
              type: "text",
              text: `Deleted store "${store.name}" and its ${store.items.length} item(s).`,
            },
          ],
        })
      );
    }
    // e.currentTarget.reset();
  }

  /* ---- Build a flat list of all items for the agent context ---- */
  const allItems = stores.flatMap((s) =>
    s.items.map((i) => ({ ...i, storeName: s.name, storeId: s.id }))
  );

  return (
    <>
      <header className="app-header">
        <h1>Grocery List</h1>
        <p className="subtitle">
          {allItems.length} item{allItems.length !== 1 && "s"} across{" "}
          {stores.length} store{stores.length !== 1 && "s"}
          {" | "}
          {allItems.filter((i) => i.purchased).length} purchased
        </p>
      </header>

      {/* ---- Store columns ---- */}
      <main className="board">
        {stores.map((store) => (
          <section
            key={store.id}
            className="store-column"
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, store.id)}
          >
            <div className="store-header">
              <h2>{store.name}</h2>
              <span className="item-count">
                {store.items.filter((i) => i.purchased).length}/
                {store.items.length}
              </span>
            </div>

            <ul className="item-list">
              {store.items.map((item) => (
                <li
                  key={item.id}
                  className={`item${item.purchased ? " purchased" : ""}`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, item.id)}
                >
                  <label className="item-label">
                    <input
                      type="checkbox"
                      checked={item.purchased}
                      onChange={() =>
                        dispatch({ type: "TOGGLE_PURCHASED", itemId: item.id })
                      }
                    />
                    <span className="item-name">{item.name}</span>
                  </label>
                  <button
                    className="delete-btn"
                    onClick={() =>
                      dispatch({ type: "DELETE_ITEM", itemId: item.id })
                    }
                    aria-label={`Delete ${item.name}`}
                  >
                    &times;
                  </button>
                </li>
              ))}
              {store.items.length === 0 && (
                <li className="empty-state">No items yet</li>
              )}
            </ul>

            <form
              className="add-item-form"
              onSubmit={(e) => handleAddItemUI(e, store.id)}
            >
              <input
                type="text"
                name="item_name"
                placeholder="Add item..."
                autoComplete="off"
              />
              <button type="submit">+</button>
            </form>
          </section>
        ))}
      </main>

      {/* ============================================================ */}
      {/*  WebMCP Declarative Tool Forms (visually hidden)             */}
      {/* ============================================================ */}
      <div className="webmcp-tools" aria-hidden="true">
        {/* ---- add_item ---- */}
        <form
          toolname="add_item"
          tooldescription="Add a grocery item to a specific store's shopping list. Returns confirmation with the item name and store."
          toolautosubmit=""
          onSubmit={handleToolAddItem}
        >
          <label htmlFor="tool-add-store">Store</label>
          <select
            name="store_id"
            id="tool-add-store"
            required
            toolparamdescription="The store to add the item to. Choose from the available stores."
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <label htmlFor="tool-add-name">Item name</label>
          <input
            type="text"
            name="item_name"
            id="tool-add-name"
            required
            toolparamdescription="The name of the grocery item to add, e.g. 'Milk', 'Bananas', 'Chicken Breast'"
          />
          <button type="submit">Add Item</button>
        </form>

        {/* ---- delete_item ---- */}
        <form
          toolname="delete_item"
          tooldescription="Remove a grocery item from any store by its ID. Use the get_all_items or get_items_by_store tool first to find the item ID."
          toolautosubmit=""
          onSubmit={handleToolDeleteItem}
        >
          <label htmlFor="tool-delete-id">Item ID</label>
          <input
            type="text"
            name="item_id"
            id="tool-delete-id"
            required
            toolparamdescription="The unique ID of the grocery item to delete"
          />
          <button type="submit">Delete Item</button>
        </form>

        {/* ---- toggle_purchased ---- */}
        <form
          toolname="toggle_purchased"
          tooldescription="Toggle the purchased status of a grocery item. Use the get_all_items or get_items_by_store tool first to find the item ID and its current status."
          toolautosubmit=""
          onSubmit={handleToolTogglePurchased}
        >
          <label htmlFor="tool-toggle-id">Item ID</label>
          <input
            type="text"
            name="item_id"
            id="tool-toggle-id"
            required
            toolparamdescription="The unique ID of the grocery item to mark as purchased or not purchased"
          />
          <button type="submit">Toggle Purchased</button>
        </form>

        {/* ---- move_item ---- */}
        <form
          toolname="move_item"
          tooldescription="Move a grocery item from one store to another. Use the get_all_items or get_items_by_store tool first to find the item ID."
          toolautosubmit=""
          onSubmit={handleToolMoveItem}
        >
          <label htmlFor="tool-move-id">Item ID</label>
          <input
            type="text"
            name="item_id"
            id="tool-move-id"
            required
            toolparamdescription="The unique ID of the grocery item to move"
          />
          <label htmlFor="tool-move-target">Target store</label>
          <select
            name="target_store_id"
            id="tool-move-target"
            required
            toolparamdescription="The store to move the item to"
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button type="submit">Move Item</button>
        </form>

        {/* ---- add_store ---- */}
        <form
          toolname="add_store"
          tooldescription="Create a new store column in the grocery list. The store starts with an empty item list."
          toolautosubmit=""
          onSubmit={handleToolAddStore}
        >
          <label htmlFor="tool-add-store-name">Store name</label>
          <input
            type="text"
            name="store_name"
            id="tool-add-store-name"
            required
            toolparamdescription="The name of the new store, e.g. 'Trader Joe''s', 'Target', 'Costco'"
          />
          <button type="submit">Add Store</button>
        </form>

        {/* ---- delete_store ---- */}
        <form
          toolname="delete_store"
          tooldescription="Delete a store column and all of its grocery items."
          toolautosubmit=""
          onSubmit={handleToolDeleteStore}
        >
          <label htmlFor="tool-delete-store">Store</label>
          <select
            name="store_id"
            id="tool-delete-store"
            required
            toolparamdescription="The store to delete along with all its items"
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button type="submit">Delete Store</button>
        </form>
      </div>
    </>
  );
}
