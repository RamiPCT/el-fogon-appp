export const formatPrice = (amount) => {
  const num = Number(amount) || 0;
  return `${num.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
};
