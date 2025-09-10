import React, { useState } from 'react';
import AddResident from './AddResident';
import SearchResident from './SearchResident';
import ResidentList from './ResidentList';

function App() {
  const [residents, setResidents] = useState([]);
  const [filtered, setFiltered] = useState([]);

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial' }}>
      <h1>Neurology Residency Scheduler Prototype</h1>
      <AddResident residents={residents} setResidents={setResidents} />
      <SearchResident residents={residents} setFiltered={setFiltered} />
      <ResidentList residents={filtered.length ? filtered : residents} />
    </div>
  );
}

export default App;
