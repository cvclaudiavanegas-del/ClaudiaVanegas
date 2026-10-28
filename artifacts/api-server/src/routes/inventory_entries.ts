import { Router, type IRouter } from "express";
import { eq, desc, sql, inArray } from "drizzle-orm";
import {
  db,
  inventoryEntriesTable,
  productsTable,
  productVariantsTable,
  suppliersTable,
  accountsPayableTable,
  apPaymentsTable,
} from "@workspace/db";
import { requireAuth, requireAdmin } from "../lib/auth";

const router: IRouter = Router();

// POST /inventory-entries — receive a batch of merchandise items in one transaction
router.post("/inventory-entries", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const { entries } = req.body;

  if (!Array.isArray(entries) || entries.length === 0) {
    res.status(400).json({ error: "Se requiere al menos un ítem en 'entries'" }); return;
  }

  // Validate every row up-front
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e.productId || typeof e.productId !== "number" || !Number.isInteger(e.productId)) {
      res.status(400).json({ error: `Fila ${i + 1}: productId inválido` }); return;
    }
    if (!e.qty || typeof e.qty !== "number" || !Number.isInteger(e.qty) || e.qty < 1) {
      res.status(400).json({ error: `Fila ${i + 1}: qty debe ser un entero positivo` }); return;
    }
    if (e.unitCost == null || typeof e.unitCost !== "number" || e.unitCost <= 0) {
      res.status(400).json({ error: `Fila ${i + 1}: unitCost debe ser un número positivo` }); return;
    }
  }

  // Load all referenced products in one query
  const productIds = [...new Set(entries.map((e: any) => e.productId as number))];
  const products = await db.select().from(productsTable).where(inArray(productsTable.id, productIds));
  const productMap = Object.fromEntries(products.map(p => [p.id, p]));

  for (let i = 0; i < entries.length; i++) {
    if (!productMap[entries[i].productId]) {
      res.status(404).json({ error: `Fila ${i + 1}: Producto no encontrado` }); return;
    }
  }

  // Single transaction for the whole batch
  const results = await db.transaction(async (tx) => {
    const created = [];

    for (const item of entries) {
      const { productId, variantId, supplierId, qty, unitCost, salePrice, paymentStatus, dueDate, notes } = item;
      const isPaid = !paymentStatus || paymentStatus === "paid";
      const totalCost = qty * unitCost;
      const product = productMap[productId];

      // 1. Record entry
      const [newEntry] = await tx.insert(inventoryEntriesTable).values({
        productId,
        variantId: variantId ?? null,
        supplierId: supplierId ?? null,
        qty,
        unitCost: String(unitCost),
        totalCost: String(totalCost),
        notes: notes ?? null,
      }).returning();

      // 2. Update stock + prices
      if (variantId) {
        await tx.update(productVariantsTable)
          .set({ stock: sql`${productVariantsTable.stock} + ${qty}` })
          .where(eq(productVariantsTable.id, variantId));
        // Sync product.stock = sum of variants, and update prices if provided
        const priceUpdate: Record<string, any> = {
          stock: sql`(SELECT COALESCE(SUM(stock), 0) FROM product_variants WHERE product_id = ${productId})`,
        };
        if (unitCost) priceUpdate.costPrice = String(unitCost);
        if (salePrice) priceUpdate.salePrice = String(salePrice);
        await tx.update(productsTable).set(priceUpdate).where(eq(productsTable.id, productId));
      } else {
        const stockUpdate: Record<string, any> = {
          stock: sql`${productsTable.stock} + ${qty}`,
        };
        if (unitCost) stockUpdate.costPrice = String(unitCost);
        if (salePrice) stockUpdate.salePrice = String(salePrice);
        await tx.update(productsTable).set(stockUpdate).where(eq(productsTable.id, productId));
      }

      // 3. Create AP record
      const variantLabel = variantId ? " (variante)" : "";
      const [ap] = await tx.insert(accountsPayableTable).values({
        type: "inventory_entry" as any,
        description: `Ingreso inventario: ${product.name}${variantLabel} × ${qty}`,
        totalAmount: String(totalCost),
        paidAmount: isPaid ? String(totalCost) : "0",
        status: isPaid ? "paid" : "pending",
        dueDate: (!isPaid && dueDate) ? dueDate : null,
      }).returning();

      // 4. Record payment only if paid
      if (isPaid) {
        await tx.insert(apPaymentsTable).values({
          accountPayableId: ap.id,
          amount: String(totalCost),
          notes: `Recepción mercancía — ${product.name}${variantLabel}`,
        });
      }

      created.push(newEntry);
    }

    return created;
  });

  res.status(201).json(results.map(entry => ({
    id: entry.id,
    productId: entry.productId,
    variantId: entry.variantId,
    supplierId: entry.supplierId,
    qty: entry.qty,
    unitCost: parseFloat(entry.unitCost),
    totalCost: parseFloat(entry.totalCost),
    notes: entry.notes,
    createdAt: entry.createdAt,
  })));
});

// GET /inventory-entries?productId=X
router.get("/inventory-entries", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const productIdRaw = req.query.productId;
  const productIdValue = Array.isArray(productIdRaw) ? productIdRaw[0] : productIdRaw;
  const productId = typeof productIdValue === "string" && productIdValue ? Number.parseInt(productIdValue, 10) : null;

  const rows = await db.select({
    id: inventoryEntriesTable.id,
    productId: inventoryEntriesTable.productId,
    variantId: inventoryEntriesTable.variantId,
    supplierId: inventoryEntriesTable.supplierId,
    supplierName: suppliersTable.name,
    qty: inventoryEntriesTable.qty,
    unitCost: inventoryEntriesTable.unitCost,
    totalCost: inventoryEntriesTable.totalCost,
    notes: inventoryEntriesTable.notes,
    createdAt: inventoryEntriesTable.createdAt,
  }).from(inventoryEntriesTable)
    .leftJoin(suppliersTable, eq(inventoryEntriesTable.supplierId, suppliersTable.id))
    .where(productId ? eq(inventoryEntriesTable.productId, productId) : sql`1=1`)
    .orderBy(desc(inventoryEntriesTable.createdAt))
    .limit(200);

  res.json(rows.map(r => ({
    id: r.id,
    productId: r.productId,
    variantId: r.variantId,
    supplierId: r.supplierId,
    supplierName: r.supplierName ?? null,
    qty: r.qty,
    unitCost: parseFloat(r.unitCost),
    totalCost: parseFloat(r.totalCost),
    notes: r.notes,
    createdAt: r.createdAt,
  })));
});

export default router;
