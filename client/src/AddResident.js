import React, { useState } from 'react';

function AddResident({ residents, setResidents }) {
  const [name, setName] = useState('');
  const [year, setYear] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (name && year) {
      setResidents([...residents, { name, year }]);
      setName('');
      setYear('');
    }
  };

  return (
    <div>
      <h2>Add Resident</h2>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={name}
          placeholder="Name"
          onChange={(e) => setName(e.target.value)}
          required
        />
        <select value={year} onChange={(e) => setYear(e.target.value)} required>
          <option value="">Select Year</option>
          <option value="PGY2">PGY2</option>
          <option value="PGY3">PGY3</option>
          <option value="PGY4">PGY4</option>
        </select>
        <button type="submit">Add</button>
      </form>
    </div>
  );
}

export default AddResident;
