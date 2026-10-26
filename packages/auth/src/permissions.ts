import { createAccessControl } from "better-auth/plugins/access";
import {
	adminAc,
	defaultStatements,
	ownerAc,
} from "better-auth/plugins/organization/access";

// Brief §4: a role plus a scope (project_member). Later milestones add
// statements for their own features (leads, units, exports, targets).
export const statements = {
	...defaultStatements,
	project: ["create", "update", "delete"],
	projectScope: ["assign"],
	roleLabel: ["update"],
	team: ["read"],
	audit: ["read"],
	// M2: manage = sections, unit types, import; price / block also for managers in scope.
	unit: ["read", "manage", "price", "block"],
	// M3: capture = quick capture; assign = choose an owner / send to pool.
	// M4: claim = take a lead from the pool (salespeople only, brief §6).
	lead: ["capture", "read", "assign", "claim"],
	contact: ["update"],
	leadSource: ["manage"],
	campaign: ["manage"],
	rules: ["update"],
} as const;

export const ac = createAccessControl(statements);

const settings = {
	project: ["create", "update", "delete"],
	projectScope: ["assign"],
	roleLabel: ["update"],
	team: ["read"],
	audit: ["read"],
	unit: ["read", "manage", "price", "block"],
	lead: ["capture", "read", "assign"],
	contact: ["update"],
	leadSource: ["manage"],
	campaign: ["manage"],
	rules: ["update"],
} as const;

export const roles = {
	owner: ac.newRole({ ...ownerAc.statements, ...settings }),
	admin: ac.newRole({ ...adminAc.statements, ...settings }),
	executive: ac.newRole({
		team: ["read"],
		audit: ["read"],
		unit: ["read"],
		lead: ["read"],
	}),
	sales_manager: ac.newRole({
		team: ["read"],
		unit: ["read", "price", "block"],
		lead: ["capture", "read", "assign"],
		contact: ["update"],
	}),
	salesperson: ac.newRole({
		unit: ["read"],
		lead: ["capture", "read", "claim"],
		contact: ["update"],
	}),
};

export type RoleName = keyof typeof roles;
export const roleNames = Object.keys(roles) as RoleName[];

/** Roles whose visibility is limited to the projects in their scope. */
export const scopedRoles: readonly RoleName[] = [
	"sales_manager",
	"salesperson",
];

export function isRoleName(value: string): value is RoleName {
	return value in roles;
}

export type Permissions = {
	[K in keyof typeof statements]?: (typeof statements)[K][number][];
};

export function roleCan(role: RoleName, permissions: Permissions) {
	return roles[role].authorize(permissions).success;
}
