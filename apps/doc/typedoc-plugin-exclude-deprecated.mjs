// @ts-check
/**
 * Leaves the top-level declarations marked `@deprecated` (classes, interfaces, type aliases,
 * functions, variables, enums) out of the API reference, the way TypeDoc leaves out `@hidden`
 * ones: removed from the project when it starts resolving. Deprecated members of documented
 * declarations stay, with their deprecation notes.
 */
import { Converter, ReflectionKind } from 'typedoc';

const TOP_LEVEL_KINDS =
  ReflectionKind.Class |
  ReflectionKind.Interface |
  ReflectionKind.TypeAlias |
  ReflectionKind.Function |
  ReflectionKind.Variable |
  ReflectionKind.Enum;

/** @param {import('typedoc').Reflection} reflection */
function isDeprecated(reflection) {
  if (reflection.comment?.getTag('@deprecated')) {
    return true;
  }
  // A function's comment sits on its signatures
  const signatures = /** @type {import('typedoc').DeclarationReflection} */ (reflection).signatures;
  return !!signatures?.length && signatures.every((signature) => !!signature.comment?.getTag('@deprecated'));
}

/** @param {import('typedoc').Application} app */
export function load(app) {
  app.converter.on(Converter.EVENT_RESOLVE_BEGIN, (context) => {
    const project = context.project;
    const deprecated = Object.values(project.reflections).filter(
      (reflection) =>
        reflection.kindOf(TOP_LEVEL_KINDS) &&
        !!reflection.parent?.kindOf(ReflectionKind.SomeModule) &&
        isDeprecated(reflection)
    );
    for (const reflection of deprecated) {
      app.logger.verbose(`Excluding deprecated ${reflection.getFullName()}`);
      project.removeReflection(reflection);
    }
  });
}
