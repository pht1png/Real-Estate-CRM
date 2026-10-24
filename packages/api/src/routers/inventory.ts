import { requirePermission, router } from "../index";
import {
	createSection,
	createSectionInput,
	deleteSection,
	listSections,
	listSectionsInput,
	moveSection,
	moveSectionInput,
	sectionIdInput,
	updateSection,
	updateSectionInput,
} from "../services/section";
import {
	blockUnit,
	unblockUnit,
	unitGrid,
	unitGridInput,
	unitIdInput,
	unitPriceHistoryList,
	updateUnitPrice,
	updateUnitPriceInput,
} from "../services/unit";
import {
	commitUnitImport,
	previewUnitImport,
	unitImportInput,
	unitImportTemplate,
} from "../services/unit-import";
import {
	createUnitType,
	createUnitTypeInput,
	deleteUnitType,
	listUnitTypes,
	listUnitTypesInput,
	unitTypeIdInput,
	updateUnitType,
	updateUnitTypeInput,
} from "../services/unit-type";

const read = requirePermission({ unit: ["read"] });
const manage = requirePermission({ unit: ["manage"] });

export const sectionRouter = router({
	list: read
		.input(listSectionsInput)
		.query(({ ctx, input }) => listSections(ctx.db, ctx.tenant, input)),
	create: manage
		.input(createSectionInput)
		.mutation(({ ctx, input }) => createSection(ctx.db, ctx.tenant, input)),
	update: manage
		.input(updateSectionInput)
		.mutation(({ ctx, input }) => updateSection(ctx.db, ctx.tenant, input)),
	move: manage
		.input(moveSectionInput)
		.mutation(({ ctx, input }) => moveSection(ctx.db, ctx.tenant, input)),
	delete: manage
		.input(sectionIdInput)
		.mutation(({ ctx, input }) => deleteSection(ctx.db, ctx.tenant, input)),
});

export const unitTypeRouter = router({
	list: read
		.input(listUnitTypesInput)
		.query(({ ctx, input }) =>
			listUnitTypes(ctx.db, ctx.files, ctx.tenant, input),
		),
	create: manage
		.input(createUnitTypeInput)
		.mutation(({ ctx, input }) => createUnitType(ctx.db, ctx.tenant, input)),
	update: manage
		.input(updateUnitTypeInput)
		.mutation(({ ctx, input }) => updateUnitType(ctx.db, ctx.tenant, input)),
	delete: manage
		.input(unitTypeIdInput)
		.mutation(({ ctx, input }) => deleteUnitType(ctx.db, ctx.tenant, input)),
});

export const unitRouter = router({
	grid: read
		.input(unitGridInput)
		.query(({ ctx, input }) => unitGrid(ctx.db, ctx.tenant, input)),
	priceHistory: read
		.input(unitIdInput)
		.query(({ ctx, input }) => unitPriceHistoryList(ctx.db, ctx.tenant, input)),
	updatePrice: requirePermission({ unit: ["price"] })
		.input(updateUnitPriceInput)
		.mutation(({ ctx, input }) => updateUnitPrice(ctx.db, ctx.tenant, input)),
	block: requirePermission({ unit: ["block"] })
		.input(unitIdInput)
		.mutation(({ ctx, input }) => blockUnit(ctx.db, ctx.tenant, input)),
	unblock: requirePermission({ unit: ["block"] })
		.input(unitIdInput)
		.mutation(({ ctx, input }) => unblockUnit(ctx.db, ctx.tenant, input)),
	importTemplate: manage.query(() => unitImportTemplate()),
	importPreview: manage
		.input(unitImportInput)
		.mutation(({ ctx, input }) => previewUnitImport(ctx.db, ctx.tenant, input)),
	importCommit: manage
		.input(unitImportInput)
		.mutation(({ ctx, input }) => commitUnitImport(ctx.db, ctx.tenant, input)),
});
