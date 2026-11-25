import { Utensils, UtensilsCrossed, Flame, Martini, Beer, Wine, CakeSlice, Salad, Soup, Coffee, Beef } from 'lucide-react';

// Quita los emojis del principio del nombre ("🍢 Para Picar" → "Para Picar").
// Los datos no se tocan: solo cambia cómo se muestra.
export const cleanName = (name = '') => String(name).replace(/^[\p{Extended_Pictographic}\p{Emoji_Modifier}️‍\s]+/u, '').trim() || String(name);

const RULES = [
  [/c[oó]ctel|cocktail|\bgin\b|trago/i, Martini],
  [/cerveza|beer/i, Beer],
  [/vino|wine/i, Wine],
  [/postre|dulce|dessert|sweet/i, CakeSlice],
  [/brasa|carb[oó]n|parrilla|grill|fuego/i, Flame],
  [/carne|beef|steak/i, Beef],
  [/ensalada|salad|verde/i, Salad],
  [/sopa|soup|caldo/i, Soup],
  [/caf[eé]|coffee/i, Coffee],
  [/picar|tapa|entrante|compartir|share|starter/i, Utensils]
];

// Icono de línea para una categoría, según su nombre o descripción
export const categoryIcon = (cat) => {
  const text = `${cat?.name || ''} ${cat?.name_en || ''} ${cat?.description || ''}`;
  const hit = RULES.find(([re]) => re.test(text));
  return hit ? hit[1] : UtensilsCrossed;
};
