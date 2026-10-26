`slug.ts` exports `slugify`, but it leaves punctuation in the result and does not collapse repeated separators.
Fix it so the result contains only lowercase letters, digits and single hyphens, with no leading or trailing hyphen.
Only edit `slug.ts`.
