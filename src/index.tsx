/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App";
import {Toaster} from "solid-toast";

render(() => {
     return (
         <div>
             <Toaster
                 position="bottom-right"
                 gutter={8}
             />
             <App/>
         </div>
         );
}, document.getElementById("root") as HTMLElement);
