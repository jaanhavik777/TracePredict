
"use client";

import { useEffect, useState } from "react";

type User = {
  user_id: number;
  role_id: number;
  full_name: string;
  email: string;
  is_active: boolean;
  created_at: string;
};

type Service = {
  service_id: number;
  service_name: string;
  description: string | null;
  criticality: string;
  service_status: string;
  owner_id: number | null;
};

type Dependency = {
  dependency_id: number;
  service_id: number;
  service_name: string;
  depends_on_service_id: number;
  depends_on_service_name: string;
};

type Tab = "users" | "services" | "dependencies";

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>("users");
  const [users, setUsers] = useState<User[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [userForm, setUserForm] = useState({
    full_name: "",
    email: "",
    password: "",
    role_id: "2",
  });

  const [serviceForm, setServiceForm] = useState({
    service_name: "",
    description: "",
    criticality: "MEDIUM",
    service_status: "ACTIVE",
    owner_id: "",
  });

  const [editingService, setEditingService] = useState<number | null>(null);

  const [dependencyForm, setDependencyForm] = useState({
    serviceId: "",
    dependsOnServiceId: "",
  });

  async function apiRequest(url: string, options?: RequestInit) {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Something went wrong");
    }

    return data;
  }

  async function loadUsers() {
    const data = await apiRequest("/api/users");
    setUsers(data.users);
  }

  async function loadServices() {
    const data = await apiRequest("/api/services");
    setServices(data.services);
  }

  async function loadDependencies() {
    const data = await apiRequest("/api/dependencies");
    setDependencies(data.dependencies);
  }

  async function refreshData() {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      if (activeTab === "users") await loadUsers();
      if (activeTab === "services") await loadServices();
      if (activeTab === "dependencies") {
        await Promise.all([loadDependencies(), loadServices()]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshData();
  }, [activeTab]);

  async function createUser(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setMessage("");

    try {
      await apiRequest("/api/users", {
        method: "POST",
        body: JSON.stringify({
          ...userForm,
          role_id: Number(userForm.role_id),
        }),
      });

      setUserForm({
        full_name: "",
        email: "",
        password: "",
        role_id: "2",
      });

      setMessage("User created successfully.");
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create user");
    }
  }

  async function toggleUser(user: User) {
    setError("");
    setMessage("");

    try {
      await apiRequest("/api/users", {
        method: "PATCH",
        body: JSON.stringify({
          user_id: user.user_id,
          is_active: !user.is_active,
        }),
      });

      setMessage("User status updated successfully.");
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update user");
    }
  }

  async function saveService(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setMessage("");

    try {
      const payload = {
        ...serviceForm,
        owner_id: serviceForm.owner_id
          ? Number(serviceForm.owner_id)
          : null,
      };

      if (editingService !== null) {
        await apiRequest("/api/services", {
          method: "PATCH",
          body: JSON.stringify({
            service_id: editingService,
            ...payload,
          }),
        });
        setMessage("Service updated successfully.");
      } else {
        await apiRequest("/api/services", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setMessage("Service created successfully.");
      }

      setEditingService(null);
      setServiceForm({
        service_name: "",
        description: "",
        criticality: "MEDIUM",
        service_status: "ACTIVE",
        owner_id: "",
      });

      await loadServices();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save service");
    }
  }

  function editService(service: Service) {
    setEditingService(service.service_id);
    setServiceForm({
      service_name: service.service_name,
      description: service.description || "",
      criticality: service.criticality,
      service_status: service.service_status,
      owner_id: service.owner_id?.toString() || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function addDependency(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setMessage("");

    try {
      await apiRequest("/api/dependencies", {
        method: "POST",
        body: JSON.stringify({
          serviceId: Number(dependencyForm.serviceId),
          dependsOnServiceId: Number(dependencyForm.dependsOnServiceId),
        }),
      });

      setDependencyForm({
        serviceId: "",
        dependsOnServiceId: "",
      });

      setMessage("Dependency added successfully.");
      await loadDependencies();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add dependency");
    }
  }

  async function deleteDependency(id: number) {
    if (!window.confirm("Are you sure you want to remove this dependency?")) {
      return;
    }

    setError("");
    setMessage("");

    try {
      await apiRequest(`/api/dependencies?dependency_id=${id}`, {
        method: "DELETE",
      });

      setMessage("Dependency deleted successfully.");
      await loadDependencies();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete dependency");
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "users", label: "Users" },
    { id: "services", label: "Services" },
    { id: "dependencies", label: "Dependencies" },
  ];

  return (
    <main className="admin-shell">
      <div>
        <header className="admin-header">
          <h1>Administration</h1>
          <p className="muted">
            Manage users, services and service dependencies.
          </p>
        </header>

        <nav className="admin-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="btn btn-blue"
              aria-pressed={activeTab === tab.id}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {error && (
          <div className="card error">
            {error}
          </div>
        )}

        {message && (
          <div className="card success">
            {message}
          </div>
        )}

        {loading && (
          <p className="muted">Loading data...</p>
        )}

        {activeTab === "users" && (
          <section className="admin-columns">
            <div className="card">
              <h2>Create User</h2>

              <form onSubmit={createUser} className="admin-form">
                <div>
                  <label>
                    Full name
                  </label>
                  <input
                    required
                    maxLength={100}
                    value={userForm.full_name}
                    onChange={(e) =>
                      setUserForm({ ...userForm, full_name: e.target.value })
                    }
                    
                    placeholder="Enter full name"
                  />
                </div>

                <div>
                  <label>
                    Email
                  </label>
                  <input
                    required
                    type="email"
                    maxLength={150}
                    value={userForm.email}
                    onChange={(e) =>
                      setUserForm({ ...userForm, email: e.target.value })
                    }
                    
                    placeholder="name@example.com"
                  />
                </div>

                <div>
                  <label>
                    Password
                  </label>
                  <input
                    required
                    type="password"
                    minLength={8}
                    value={userForm.password}
                    onChange={(e) =>
                      setUserForm({ ...userForm, password: e.target.value })
                    }
                    
                    placeholder="At least 8 characters"
                  />
                </div>

                <div>
                  <label>
                    Role
                  </label>
                  <select
                    value={userForm.role_id}
                    onChange={(e) =>
                      setUserForm({ ...userForm, role_id: e.target.value })
                    }
                  >
                    <option value="2">Engineer</option>
                    <option value="1">Admin</option>
                  </select>
                </div>

                <button
                  type="submit"
                  className="btn"
                >
                  Create User
                </button>
              </form>
            </div>

            <div className="card">
              <div className="admin-section-head">
                <h2>User Management</h2>
                <span className="muted">
                  {users.length} users
                </span>
              </div>

              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.user_id}>
                        <td>{user.full_name}</td>
                        <td>{user.email}</td>
                        <td>
                          {user.role_id === 1 ? "Admin" : "Engineer"}
                        </td>
                        <td>
                          <span
                            className={`badge ${
                              user.is_active
                                ? "sev-low"
                                : "sev-critical"
                            }`}
                          >
                            {user.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td>
                          <button
                            onClick={() => toggleUser(user)}
                            className="btn btn-blue btn-sm"
                          >
                            {user.is_active ? "Deactivate" : "Activate"}
                          </button>
                        </td>
                      </tr>
                    ))}

                    {users.length === 0 && (
                      <tr>
                        <td colSpan={5} className="muted">
                          No users found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {activeTab === "services" && (
  <section>

    {/* Create / Edit Service Form */}
    <div className="card">
      <h2>
        {editingService !== null ? "Edit Service" : "Create Service"}
      </h2>

      <form onSubmit={saveService} className="admin-form grid2">

        <div>
          <label>
            Service Name
          </label>
          <input
            required
            maxLength={100}
            value={serviceForm.service_name}
            onChange={(e) =>
              setServiceForm({
                ...serviceForm,
                service_name: e.target.value,
              })
            }
            
            placeholder="Enter service name"
          />
        </div>

        <div>
          <label>
            Criticality
          </label>
          <select
            value={serviceForm.criticality}
            onChange={(e) =>
              setServiceForm({
                ...serviceForm,
                criticality: e.target.value,
              })
            }
          >
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="CRITICAL">Critical</option>
          </select>
        </div>

        <div>
          <label>
            Service Status
          </label>
          <select
            value={serviceForm.service_status}
            onChange={(e) =>
              setServiceForm({
                ...serviceForm,
                service_status: e.target.value,
              })
            }
          >
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </div>

        <div>
          <label>
            Owner ID (optional)
          </label>
          <input
            type="number"
            min="1"
            value={serviceForm.owner_id}
            onChange={(e) =>
              setServiceForm({
                ...serviceForm,
                owner_id: e.target.value,
              })
            }
            
            placeholder="Enter owner user ID"
          />
        </div>

        <div className="form-span">
          <label>
            Description
          </label>
          <textarea
            value={serviceForm.description}
            onChange={(e) =>
              setServiceForm({
                ...serviceForm,
                description: e.target.value,
              })
            }
            rows={3}
            
            placeholder="Describe the service..."
          />
        </div>

        <div className="row form-span">
          <button
            type="submit"
            className="btn"
          >
            {editingService !== null ? "Update Service" : "Create Service"}
          </button>

          {editingService !== null && (
            <button
              type="button"
              onClick={() => {
                setEditingService(null);
                setServiceForm({
                  service_name: "",
                  description: "",
                  criticality: "MEDIUM",
                  service_status: "ACTIVE",
                  owner_id: "",
                });
              }}
              className="btn btn-blue"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>

    {/* Service List */}
    <div className="card">
      <div className="admin-section-head">
        <h2>Service Management</h2>
        <span className="muted">
          {services.length} services
        </span>
      </div>

      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Service ID</th>
              <th>Service Name</th>
              <th>Description</th>
              <th>Criticality</th>
              <th>Status</th>
              <th>Owner ID</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {services.map((service) => (
              <tr key={service.service_id}>
                <td>{service.service_id}</td>

                <td>
                  {service.service_name}
                </td>

                <td>
                  {service.description || "—"}
                </td>

                <td>
                  <span className="badge sev-high">
                    {service.criticality}
                  </span>
                </td>

                <td>
                  <span
                    className={`badge ${
                      service.service_status === "ACTIVE"
                        ? "sev-low"
                        : "sev-critical"
                    }`}
                  >
                    {service.service_status}
                  </span>
                </td>

                <td>
                  {service.owner_id ?? "—"}
                </td>

                <td>
                  <button
                    type="button"
                    onClick={() => editService(service)}
                    className="btn btn-blue btn-sm"
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}

            {services.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="muted"
                >
                  No services found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  </section>
)}

        {activeTab === "dependencies" && (
  <section>

    {/* Add Dependency */}
    <div className="card">
      <h2>Add Service Dependency</h2>

      <form onSubmit={addDependency} className="admin-form grid2">

        <div>
          <label>
            Service
          </label>
          <select
            required
            value={dependencyForm.serviceId}
            onChange={(e) =>
              setDependencyForm({
                ...dependencyForm,
                serviceId: e.target.value,
              })
            }
          >
            <option value="">Select a service</option>
            {services.map((service) => (
              <option
                key={service.service_id}
                value={service.service_id}
              >
                {service.service_name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>
            Depends On
          </label>
          <select
            required
            value={dependencyForm.dependsOnServiceId}
            onChange={(e) =>
              setDependencyForm({
                ...dependencyForm,
                dependsOnServiceId: e.target.value,
              })
            }
          >
            <option value="">Select a dependency</option>
            {services.map((service) => (
              <option
                key={service.service_id}
                value={service.service_id}
              >
                {service.service_name}
              </option>
            ))}
          </select>
        </div>

        <div className="form-span">
          <button
            type="submit"
            disabled={
              !dependencyForm.serviceId ||
              !dependencyForm.dependsOnServiceId
            }
            className="btn"
          >
            Add Dependency
          </button>
        </div>
      </form>
    </div>

    {/* Dependency List */}
    <div className="card">
      <div className="admin-section-head">
        <h2>Service Dependencies</h2>
        <span className="muted">
          {dependencies.length} dependencies
        </span>
      </div>

      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Dependency ID</th>
              <th>Service</th>
              <th>Depends On</th>
              <th>Relationship</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {dependencies.map((dependency) => (
              <tr key={dependency.dependency_id}>
                <td>{dependency.dependency_id}</td>

                <td>
                  {dependency.service_name}
                </td>

                <td>
                  {dependency.depends_on_service_name}
                </td>

                <td>
                  {dependency.service_name} →{" "}
                  {dependency.depends_on_service_name}
                </td>

                <td>
                  <button
                    type="button"
                    onClick={() =>
                      deleteDependency(dependency.dependency_id)
                    }
                    className="btn btn-blue btn-sm danger"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}

            {dependencies.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="muted"
                >
                  No dependencies found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  </section>
)}
      </div>
    </main>
  );
}
