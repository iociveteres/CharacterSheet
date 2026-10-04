// The socket of the /bestiary page: the edits of the user's own creatures and
// the rolls of any sheet on it (internal/roomws/bestiary.go).
import { connectSocket } from "../socket";

connectSocket("/bestiary/ws");
