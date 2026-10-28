export function filterAdminSales(sales, filters, venues, today) {
  return sales.filter(sale => {
    const upcoming = sale.days.some(day => day.date >= today);
    const venue = venues.find(venue => venue.id === sale.venueId);
    return (!filters.period || (filters.period === 'upcoming' ? upcoming : !upcoming))
      && (!filters.store || sale.stores.some(store => store.storeId === Number(filters.store)))
      && (!filters.city || venue?.city === filters.city)
      && (!filters.venue || sale.venueId === Number(filters.venue));
  });
}
