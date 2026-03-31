"""HTTP route handlers for the test application."""

from app import get_user_by_id, create_user, search_users, delete_user, UserService


def handle_get_user(request):
    """GET /users/:id — no authentication check."""
    user_id = request.get("params", {}).get("id")
    user = get_user_by_id(user_id)
    if user is None:
        return {"status": 404, "body": "Not found"}
    return {"status": 200, "body": user}


def handle_create_user(request):
    """POST /users — creates user from request body."""
    body = request.get("body", {})
    name = body.get("name", "")
    email = body.get("email", "")
    password = body.get("password", "")

    if not name or not email or not password:
        return {"status": 400, "body": "Missing required fields"}

    user_id = create_user(name, email, password)
    return {"status": 201, "body": {"id": user_id}}


def handle_search(request):
    """GET /users/search?q= — passes user input directly to search."""
    query = request.get("query", {}).get("q", "")
    results = search_users(query)
    return {"status": 200, "body": results}


def handle_delete_user(request):
    """DELETE /users/:id — no authorization check."""
    user_id = request.get("params", {}).get("id")
    delete_user(user_id)
    return {"status": 204, "body": ""}


def handle_login(request):
    """POST /login — authenticates user."""
    body = request.get("body", {})
    username = body.get("username", "")
    password = body.get("password", "")

    service = UserService()
    try:
        if service.authenticate(username, password):
            return {"status": 200, "body": {"token": "fake-token"}}
        return {"status": 401, "body": "Invalid credentials"}
    finally:
        service.close()
