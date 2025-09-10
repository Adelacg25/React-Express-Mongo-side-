import React, { useState } from 'react';

function SearchResident({ residents, setFiltered }) {
  const [query, setQuery] = useState('');

  const handleSearch = () => {
    const filtered = residents.filter(r =>
      r.name.toLowerCase().includes(query.toLowerCase())
    );
    setFiltered(filtered);
  };

  return (
    <div>
      <h2>Search Resident</h2>
      <input
        type="text"
        value={query}
        placeholder="Search by name"
        onChange={(e) => setQuery(e.target.value)}
      />
      <button onClick={handleSearch}>Search</button>
    </div>
  );
}

export default SearchResident;