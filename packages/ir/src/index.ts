export const packageName = "@ossschem/ir" as const;

export { prettyConst, prettyNet, prettyPrimitive, type NetNames } from "./pretty.js";
export { serializeDesign } from "./serialize.js";
export {
  EMPTY_PRIMITIVE_GRAPH,
  type AlwaysBox,
  type AssignBox,
  type Bit,
  type BoxPort,
  type Design,
  type Endpoint,
  type HierPath,
  type Id,
  type Instance,
  type InstanceArray,
  type Module,
  type Net,
  type Param,
  type Port,
  type PrimKind,
  type Primitive,
  type PrimitiveGraph,
  type Sense,
  type SourceSpan,
  type ViewId,
  type Width,
} from "./types.js";
export { viewIdKey } from "./viewId.js";
