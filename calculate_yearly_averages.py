import json
import requests
from collections import defaultdict

# Fetch data from Google Sheets API
url = "https://sheets.googleapis.com/v4/spreadsheets/1tj7AbW3BkzmPZUd_pfrXmaHZrgpKgYwNljSoVoAObx8/values/Raakadata!A1:B350?key=AIzaSyDbeAW-uO-vEHuPdSJPVQwR_l1Axc7Cq7g"
response = requests.get(url)
data = response.json()

# Parse the data
rows = data['values']
header = rows[0]  # Skip header row
data_rows = rows[1:]  # Start from row 2

# Dictionary to store yearly data
yearly_data = defaultdict(list)

# Process each row
for row in data_rows:
    if len(row) >= 2:
        date_str = row[0]  # Format: "YYYY-MM"
        inflation_str = row[1]  # Format: "X.X %" or "X %"

        # Extract year
        year = int(date_str.split('-')[0])

        # Parse inflation percentage
        # Remove "%" and spaces, replace comma with dot
        inflation_value = inflation_str.replace('%', '').replace(',', '.').strip()
        inflation_float = float(inflation_value)

        # Add to yearly data
        yearly_data[year].append(inflation_float)

# Calculate and print yearly averages for 2000-2025
print("GOOGLE SHEETS DATA (vuosikeskiarvot):")
print("Year | Average | Months of data")

for year in range(2000, 2026):
    if year in yearly_data:
        values = yearly_data[year]
        average = sum(values) / len(values)
        months_count = len(values)
        print(f"{year} | {average:.1f}%   | {months_count}")
    else:
        print(f"{year} | N/A    | 0")
