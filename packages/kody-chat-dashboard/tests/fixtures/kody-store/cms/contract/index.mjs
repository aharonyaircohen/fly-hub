export const CMS_CONFIG_VERSION = 1

export const FIELD_TYPES = new Set([
  "id",
  "text",
  "textarea",
  "number",
  "boolean",
  "date",
  "select",
  "multiSelect",
  "relation",
  "relationMany",
  "json",
  "object",
  "array",
])

export const FILTER_OPERATORS = new Set([
  "equals",
  "not_equals",
  "contains",
  "in",
  "exists",
  "greater_than",
  "greater_than_equal",
  "less_than",
  "less_than_equal",
])

const READ_OPERATIONS = new Set(["list", "get", "search"])
const WRITE_OPERATIONS = new Set(["create", "update", "delete"])
const ALL_OPERATIONS = new Set([...READ_OPERATIONS, ...WRITE_OPERATIONS])
const FIELD_STORAGE_KINDS = new Set([
  "string",
  "number",
  "boolean",
  "date",
  "dateString",
  "objectId",
  "objectIdArray",
  "stringArray",
  "json",
  "object",
  "array",
])

export class CmsConfigError extends Error {
  constructor(errors) {
    super(errors.join("; "))
    this.name = "CmsConfigError"
    this.errors = errors
  }
}

export function validateCmsConfig(rawConfig) {
  const errors = []
  try {
    normalizeCmsConfig(rawConfig)
  } catch (error) {
    if (error instanceof CmsConfigError) {
      errors.push(...error.errors)
    } else {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  return { ok: errors.length === 0, errors }
}

export function normalizeCmsConfig(rawConfig) {
  const errors = []
  const raw = isRecord(rawConfig) ? rawConfig : {}

  if (raw.version !== CMS_CONFIG_VERSION) {
    errors.push(`version must be ${CMS_CONFIG_VERSION}`)
  }

  const collections = normalizeCollections(raw.collections, errors)
  const defaultAdapter = stringOr(raw.defaultAdapter, raw.adapter, "mongodb")
  const writePolicy = normalizeWritePolicy(raw.writePolicy ?? "approval-required", errors)

  for (const collection of Object.values(collections)) {
    if (!collection.adapter) collection.adapter = defaultAdapter
    if (!collection.writePolicy) collection.writePolicy = writePolicy
  }

  if (errors.length > 0) throw new CmsConfigError(errors)

  return {
    version: CMS_CONFIG_VERSION,
    name: typeof raw.name === "string" ? raw.name : "Kody CMS",
    environment: typeof raw.environment === "string" ? raw.environment : "default",
    defaultAdapter,
    writePolicy,
    adapters: isRecord(raw.adapters) ? raw.adapters : {},
    collections,
  }
}

export function getCollection(config, collectionName) {
  const normalized = normalizeCmsConfig(config)
  const collection = normalized.collections[collectionName]
  if (!collection) throw new CmsConfigError([`unknown collection: ${collectionName}`])
  return collection
}

export function listGeneratedOperations(config) {
  const normalized = normalizeCmsConfig(config)
  const result = []

  for (const collection of Object.values(normalized.collections)) {
    for (const operation of Object.keys(collection.operations)) {
      if (!collection.operations[operation]) continue
      const singular = collection.mcpName ?? singularize(collection.name)
      result.push({
        name: operation === "list"
          ? `cms_list_${collection.name}`
          : `cms_${operation}_${singular}`,
        collection: collection.name,
        operation,
        write: WRITE_OPERATIONS.has(operation),
        input: buildOperationInput(collection, operation),
      })
    }
  }

  return result
}

export function assertOperationAllowed(config, collectionName, operation, options = {}) {
  const normalized = normalizeCmsConfig(config)
  const collection = normalized.collections[collectionName]
  if (!collection) throw new CmsConfigError([`unknown collection: ${collectionName}`])
  if (!ALL_OPERATIONS.has(operation)) throw new CmsConfigError([`unknown operation: ${operation}`])
  if (!collection.operations[operation]) {
    throw new CmsConfigError([`${operation} is disabled for ${collectionName}`])
  }

  if (READ_OPERATIONS.has(operation)) return true

  const policy = collection.writePolicy ?? normalized.writePolicy
  if (operation === "delete" && policy !== "enabled") {
    throw new CmsConfigError([`delete requires writePolicy enabled for ${collectionName}`])
  }
  if (policy === "read-only") {
    throw new CmsConfigError([`${operation} blocked by read-only policy for ${collectionName}`])
  }
  if (policy === "approval-required" && options.approved !== true) {
    throw new CmsConfigError([`${operation} requires approval for ${collectionName}`])
  }

  return true
}

export function validateDocument(collection, data, options = {}) {
  const errors = []
  const partial = options.partial === true
  const value = isRecord(data) ? { ...data } : {}
  const fields = collection.fields ?? []

  for (const field of fields) {
    if (field.hidden === true && value[field.name] === undefined) continue
    const present = Object.prototype.hasOwnProperty.call(value, field.name)
    if (!partial && field.required && !present) {
      errors.push(`${field.name} is required`)
      continue
    }
    if (!present || value[field.name] === null || value[field.name] === undefined) continue
    const fieldErrors = validateFieldValue(field, value[field.name])
    errors.push(...fieldErrors)
  }

  return { ok: errors.length === 0, errors, value }
}

export function normalizeFilters(collection, filters = {}) {
  const errors = []
  const normalized = {}
  const fieldMap = new Map((collection.fields ?? []).map((field) => [field.name, field]))
  const allowedFilters = new Map(
    (collection.filters ?? []).map((filter) => [
      filter.field,
      new Set(filter.operators ?? ["equals"]),
    ]),
  )

  for (const [fieldName, condition] of Object.entries(filters ?? {})) {
    const field = fieldMap.get(fieldName)
    if (!field) {
      errors.push(`unknown filter field: ${fieldName}`)
      continue
    }
    const operators = isRecord(condition) ? condition : { equals: condition }
    for (const [operator, value] of Object.entries(operators)) {
      if (!FILTER_OPERATORS.has(operator)) {
        errors.push(`unknown filter operator: ${operator}`)
        continue
      }
      const allowed = allowedFilters.get(fieldName)
      if (allowed && !allowed.has(operator)) {
        errors.push(`${operator} is not allowed for ${fieldName}`)
        continue
      }
      normalized[fieldName] ??= {}
      normalized[fieldName][operator] = value
    }
  }

  if (errors.length > 0) throw new CmsConfigError(errors)
  return normalized
}

export function applyInMemoryFilters(docs, collection, filters = {}) {
  const normalized = normalizeFilters(collection, filters)
  return docs.filter((doc) => {
    for (const [fieldName, operators] of Object.entries(normalized)) {
      for (const [operator, expected] of Object.entries(operators)) {
        if (!matchesOperator(doc[fieldName], operator, expected)) return false
      }
    }
    return true
  })
}

export function applyInMemorySort(docs, sort = []) {
  const sortEntries = Array.isArray(sort) ? sort : []
  if (sortEntries.length === 0) return docs
  return [...docs].sort((a, b) => {
    for (const entry of sortEntries) {
      const field = typeof entry === "string" ? entry.replace(/^-/, "") : entry.field
      const direction =
        typeof entry === "string" && entry.startsWith("-")
          ? "desc"
          : entry.direction ?? "asc"
      const left = a[field]
      const right = b[field]
      if (left === right) continue
      if (left === undefined) return direction === "desc" ? 1 : -1
      if (right === undefined) return direction === "desc" ? -1 : 1
      return left > right
        ? direction === "desc" ? -1 : 1
        : direction === "desc" ? 1 : -1
    }
    return 0
  })
}

export function getCollectionIdField(collection) {
  return collection.source?.idField ?? collection.idField ?? "_id"
}

function normalizeCollections(rawCollections, errors) {
  const result = {}

  if (Array.isArray(rawCollections)) {
    for (const item of rawCollections) {
      const collection = normalizeCollection(item, errors)
      if (collection) result[collection.name] = collection
    }
    return result
  }

  if (isRecord(rawCollections)) {
    for (const [name, value] of Object.entries(rawCollections)) {
      const collection = normalizeCollection({ name, ...value }, errors)
      if (collection) result[collection.name] = collection
    }
    return result
  }

  errors.push("collections must be an object or array")
  return result
}

function normalizeCollection(rawCollection, errors) {
  if (!isRecord(rawCollection)) {
    errors.push("collection must be an object")
    return null
  }

  const name = rawCollection.name
  if (!isSlug(name)) {
    errors.push(`collection name must be a slug: ${String(name)}`)
    return null
  }

  const fields = normalizeFields(rawCollection.fields, name, errors)
  const filters = normalizeFilterConfig(rawCollection.filters, fields, name, errors)
  const operations = normalizeOperations(rawCollection.operations)
  const writePolicy = rawCollection.writePolicy
    ? normalizeWritePolicy(rawCollection.writePolicy, errors)
    : undefined
  const searchFields = normalizeSearchFields(rawCollection.searchFields, fields, name, errors)

  return {
    name,
    label: typeof rawCollection.label === "string" ? rawCollection.label : titleize(name),
    adapter: typeof rawCollection.adapter === "string" ? rawCollection.adapter : undefined,
    mcpName: typeof rawCollection.mcpName === "string" ? rawCollection.mcpName : undefined,
    source: isRecord(rawCollection.source) ? rawCollection.source : {},
    titleField: typeof rawCollection.titleField === "string" ? rawCollection.titleField : "id",
    searchFields,
    fields,
    filters,
    operations,
    writePolicy,
    defaultSort: Array.isArray(rawCollection.defaultSort) ? rawCollection.defaultSort : [],
  }
}

function normalizeSearchFields(rawSearchFields, fields, collectionName, errors) {
  if (rawSearchFields === undefined) return undefined
  if (!Array.isArray(rawSearchFields)) {
    errors.push(`${collectionName}.searchFields must be an array`)
    return undefined
  }

  const fieldNames = new Set(fields.map((field) => field.name))
  const searchFields = []
  for (const field of rawSearchFields) {
    if (typeof field !== "string" || !fieldNames.has(field)) {
      errors.push(`${collectionName}.searchFields contains unknown field: ${String(field)}`)
      continue
    }
    if (!searchFields.includes(field)) searchFields.push(field)
  }
  return searchFields
}

function normalizeFields(rawFields, collectionName, errors) {
  if (!Array.isArray(rawFields) || rawFields.length === 0) {
    errors.push(`${collectionName}.fields must be a non-empty array`)
    return []
  }

  const names = new Set()
  const fields = []
  for (const rawField of rawFields) {
    if (!isRecord(rawField)) {
      errors.push(`${collectionName}.fields contains a non-object field`)
      continue
    }
    const name = rawField.name
    const type = rawField.type
    if (!isFieldName(name)) {
      errors.push(`${collectionName}.fields has invalid field name: ${String(name)}`)
      continue
    }
    if (!FIELD_TYPES.has(type)) {
      errors.push(`${collectionName}.${name} has invalid type: ${String(type)}`)
      continue
    }
    if (names.has(name)) {
      errors.push(`${collectionName}.${name} is duplicated`)
      continue
    }
    names.add(name)
    if ((type === "select" || type === "multiSelect") && !Array.isArray(rawField.options)) {
      errors.push(`${collectionName}.${name} requires options`)
    }
    if ((type === "relation" || type === "relationMany") && !isSlug(rawField.target)) {
      errors.push(`${collectionName}.${name} requires target`)
    }
    fields.push({
      name,
      type,
      label: typeof rawField.label === "string" ? rawField.label : titleize(name),
      description: typeof rawField.description === "string" ? rawField.description : undefined,
      placeholder: typeof rawField.placeholder === "string" ? rawField.placeholder : undefined,
      required: rawField.required === true,
      hidden: rawField.hidden === true,
      readOnly: rawField.readOnly === true,
      options: Array.isArray(rawField.options) ? rawField.options : undefined,
      target: rawField.target,
      valueField: rawField.valueField ?? "_id",
      labelField: rawField.labelField ?? "title",
      labelTemplate: rawField.labelTemplate,
      display: normalizeRecord(rawField.display),
      validation: normalizeValidation(rawField.validation, errors, `${collectionName}.${name}.validation`),
      storage: normalizeStorage(rawField.storage, errors, `${collectionName}.${name}.storage`),
    })
  }
  return fields
}

function normalizeFilterConfig(rawFilters, fields, collectionName, errors) {
  if (rawFilters === undefined) return []
  if (!Array.isArray(rawFilters)) {
    errors.push(`${collectionName}.filters must be an array`)
    return []
  }

  const fieldNames = new Set(fields.map((field) => field.name))
  return rawFilters.flatMap((filter) => {
    if (!isRecord(filter) || !fieldNames.has(filter.field)) {
      errors.push(`${collectionName}.filters contains unknown field: ${String(filter?.field)}`)
      return []
    }
    const operators = Array.isArray(filter.operators) ? filter.operators : ["equals"]
    for (const operator of operators) {
      if (!FILTER_OPERATORS.has(operator)) {
        errors.push(`${collectionName}.${filter.field} has invalid filter operator: ${operator}`)
      }
    }
    return [{ field: filter.field, operators }]
  })
}

function normalizeOperations(rawOperations) {
  const defaults = {
    list: true,
    get: true,
    search: true,
    create: false,
    update: false,
    delete: false,
  }
  if (!isRecord(rawOperations)) return defaults
  return Object.fromEntries(
    Object.entries(defaults).map(([operation, value]) => [
      operation,
      rawOperations[operation] === undefined ? value : rawOperations[operation] === true,
    ]),
  )
}

function normalizeWritePolicy(policy, errors) {
  if (["read-only", "approval-required", "enabled"].includes(policy)) return policy
  errors.push(`invalid writePolicy: ${String(policy)}`)
  return "approval-required"
}

function validateFieldValue(field, value) {
  const errors = []
  const label = field.label ?? field.name
  switch (field.type) {
    case "id":
    case "text":
    case "textarea":
    case "date":
    case "relation":
      if (typeof value !== "string") errors.push(`${field.name} must be a string`)
      break
    case "number":
      if (typeof value !== "number" || Number.isNaN(value)) errors.push(`${field.name} must be a number`)
      break
    case "boolean":
      if (typeof value !== "boolean") errors.push(`${field.name} must be a boolean`)
      break
    case "select":
      if (!optionValues(field).has(value)) errors.push(`${field.name} must be one of its options`)
      break
    case "multiSelect":
      if (!Array.isArray(value)) {
        errors.push(`${field.name} must be an array`)
      } else {
        const allowed = optionValues(field)
        for (const item of value) {
          if (!allowed.has(item)) errors.push(`${field.name} contains invalid option: ${String(item)}`)
        }
      }
      break
    case "relationMany":
      if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
        errors.push(`${field.name} must be an array of ids`)
      }
      break
    case "json":
    case "object":
      if (!isRecord(value) && !Array.isArray(value)) errors.push(`${field.name} must be JSON`)
      break
    case "array":
      if (!Array.isArray(value)) errors.push(`${field.name} must be an array`)
      break
  }
  if (field.type === "number" && typeof value === "number" && !Number.isNaN(value)) {
    if (field.validation?.min !== undefined && value < field.validation.min) {
      errors.push(`${label} must be at least ${field.validation.min}`)
    }
    if (field.validation?.max !== undefined && value > field.validation.max) {
      errors.push(`${label} must be at most ${field.validation.max}`)
    }
  }
  if (isTextField(field) && typeof value === "string") {
    if (field.validation?.minLength !== undefined && value.length < field.validation.minLength) {
      errors.push(`${label} must be at least ${field.validation.minLength} characters`)
    }
    if (field.validation?.maxLength !== undefined && value.length > field.validation.maxLength) {
      errors.push(`${label} must be at most ${field.validation.maxLength} characters`)
    }
    if (field.validation?.pattern && !new RegExp(field.validation.pattern).test(value)) {
      errors.push(`${label} is invalid`)
    }
  }
  return errors
}

function matchesOperator(actual, operator, expected) {
  switch (operator) {
    case "equals":
      return actual === expected
    case "not_equals":
      return actual !== expected
    case "contains":
      return Array.isArray(actual)
        ? actual.includes(expected)
        : String(actual ?? "").toLowerCase().includes(String(expected ?? "").toLowerCase())
    case "in":
      return Array.isArray(expected) && expected.includes(actual)
    case "exists":
      return expected ? actual !== undefined && actual !== null : actual === undefined || actual === null
    case "greater_than":
      return actual > expected
    case "greater_than_equal":
      return actual >= expected
    case "less_than":
      return actual < expected
    case "less_than_equal":
      return actual <= expected
    default:
      return false
  }
}

function buildOperationInput(collection, operation) {
  if (operation === "list" || operation === "search") {
    return { filters: collection.filters, sort: collection.defaultSort }
  }
  if (operation === "get" || operation === "delete") return { idField: getCollectionIdField(collection) }
  return {
    fields: collection.fields
      .filter((field) => field.hidden !== true && field.readOnly !== true)
      .map((field) => ({ name: field.name, type: field.type, required: field.required })),
  }
}

function optionValues(field) {
  return new Set(
    (field.options ?? []).map((option) =>
      isRecord(option) ? option.value : option,
    ),
  )
}

function normalizeRecord(value) {
  if (!isRecord(value)) return undefined
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  )
}

function normalizeValidation(value, errors, label) {
  if (value === undefined) return undefined
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`)
    return undefined
  }
  const result = {}
  for (const key of ["min", "max", "minLength", "maxLength"]) {
    if (value[key] === undefined) continue
    const numeric = Number(value[key])
    if (!Number.isFinite(numeric)) {
      errors.push(`${label}.${key} must be a number`)
      continue
    }
    result[key] = numeric
  }
  if (value.pattern !== undefined) {
    if (typeof value.pattern !== "string") {
      errors.push(`${label}.pattern must be a string`)
    } else {
      try {
        new RegExp(value.pattern)
        result.pattern = value.pattern
      } catch {
        errors.push(`${label}.pattern must be a valid regular expression`)
      }
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function normalizeStorage(value, errors, label) {
  if (value === undefined) return undefined
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`)
    return undefined
  }
  if (!FIELD_STORAGE_KINDS.has(value.kind)) {
    errors.push(`${label}.kind is invalid: ${String(value.kind)}`)
    return undefined
  }
  return { kind: value.kind }
}

function isTextField(field) {
  return ["id", "text", "textarea", "date", "relation"].includes(field.type)
}

function singularize(name) {
  if (name.endsWith("ies")) return `${name.slice(0, -3)}y`
  if (name.endsWith("s")) return name.slice(0, -1)
  return name
}

function titleize(name) {
  return name
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function stringOr(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value
  }
  return undefined
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isSlug(value) {
  return typeof value === "string" && /^[a-z][a-z0-9_-]*$/.test(value)
}

function isFieldName(value) {
  return typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
}
