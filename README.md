Bootstrap  process: 

- Start MongoDB and Redis first: docker-compose.yml
- Install dependencies in all 4 folders: root package.json , plus backend , customer-widget , and agent-dashboard
- Build the two Next apps before using start , because both apps use next start : customer-widget/package.json , agent-dashboard/package.json
- Then run the root launcher: package.json
```
docker compose up -d

cd backend && npm install
cd ../customer-widget && npm 
install && npm run build
cd ../agent-dashboard && npm 
install && npm run build
cd .. && npm install

npm run start:all
```
Important

- npm run start:all starts all 3 apps and also opens 3 SSH tunnels via Serveo, as defined in package.json .
- Those tunnel names are machine-specific ( *-asus ), so on another person's system they may want to edit them first.
- The backend also expects local MongoDB and Redis plus env values from backend/.env .
For Local Development

- If they just want to run locally and avoid builds/tunnels, use 3 terminals instead:
```
cd backend && npm install && npm run 
dev
cd customer-widget && npm install && 
npm run dev
cd agent-dashboard && npm install && 
npm run dev
```
- This is usually better for first-time setup/debugging than start:all .
If you want, I can turn this into a proper root README.md setup section with copy-paste commands.