import React from 'react';

function ResidentList({ residents }) {
  return (
    <div>
      <h2>All Residents</h2>
      <table border="1" cellPadding="5">
        <thead>
          <tr>
            <th>Name</th>
            <th>Year</th>
          </tr>
        </thead>
        <tbody>
          {residents.map((r, index) => (
            <tr key={index}>
              <td>{r.name}</td>
              <td>{r.year}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default ResidentList;