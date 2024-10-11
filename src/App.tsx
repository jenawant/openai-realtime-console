import { ConsolePage } from './pages/ConsolePage';
import './App.scss';

function App(props: { username?: string; logoutUrl?: string }) {
  return (
    <div data-component='App'>
      <ConsolePage username={props.username} logoutUrl={props.logoutUrl} />
    </div>
  );
}

export default App;
