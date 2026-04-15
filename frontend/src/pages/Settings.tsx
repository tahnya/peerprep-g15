import '../App.css';
import NavBar from '../components/NavBar.tsx';
import userAxios from '../userAxios.ts';
import { useState, useEffect } from 'react';
import { Button, Card, FormControl } from 'react-bootstrap';

type User = {
    username: string;
    displayName: string;
    email: string;
    role: string;
    id: string;
    updatedAt: string;
};

const Settings = () => {
    const name = localStorage.getItem('name') || 'User';

    const [userData, setUserData] = useState<User | null>(null); // State to store user information
    const [loading, setLoading] = useState(true); // Loading state
    const [editField, setEditField] = useState<string | null>(null); // Field currently being edited
    const [updatedData, setUpdatedData] = useState<any>({}); // To store edited values

    // Fetch user information on component mount
    useEffect(() => {
        const fetchUserData = async () => {
            try {
                const response = await userAxios.get('/me');
                const user: User = {
                    username: response.data.user.username,
                    displayName: response.data.user.displayName,
                    email: response.data.user.email,
                    role: response.data.user.role,
                    id: response.data.user.id,
                    updatedAt: response.data.user.updatedAt,
                };
                setUserData(user);
                console.log('User data fetched successfully:', response.data.user);
            } catch (error) {
                console.error('Error fetching user data:', error);
            } finally {
                setLoading(false); // Set loading to false after fetching
            }
        };

        fetchUserData();
    }, []); // Empty dependency array means this runs once when the component mounts

    // Handle the edit button click to switch the field into editing mode
    const handleEditClick = (field: string) => {
        setEditField(field);
        setUpdatedData({
            ...updatedData,
            [field]: userData![field], // Use non-null assertion operator as userData is guaranteed to be set
        });
    };

    // Handle change in the input field
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>, field: string) => {
        setUpdatedData({
            ...updatedData,
            [field]: e.target.value,
        });
    };

    // Save the updated data after editing
    const handleSaveClick = async (field: string) => {
        try {
            await userAxios.patch('/me', { [field]: updatedData[field] }); // Update only the changed field
            setUserData({
                ...userData,
                [field]: updatedData[field],
            });
            setEditField(null); // Exit edit mode
        } catch (error) {
            console.error('Error saving user data:', error);
        }
    };

    if (loading) {
        return (
            <div className="d-flex justify-content-center align-items-center min-vh-100 bg-white text-dark">
                <h1 className="display-4">Loading...</h1>
            </div>
        );
    }

    return (
        <div>
            <NavBar name={name} />
            <div className="container mt-4">
                <div className="d-flex min-vh-100 bg-white text-dark">
                    <div className="text w-100">
                        <h1 className="display-4">Settings Page</h1>
                        {userData ? (
                            <div>
                                {/* Username */}
                                <Card className="mb-3">
                                    <Card.Body>
                                        <Card.Title>Username</Card.Title>
                                        <Card.Text>
                                            {editField === 'username' ? (
                                                <FormControl
                                                    value={
                                                        updatedData.username || userData.username
                                                    }
                                                    onChange={(e) => handleChange(e, 'username')}
                                                />
                                            ) : (
                                                userData.username
                                            )}
                                        </Card.Text>
                                        <Button
                                            variant="primary"
                                            onClick={() =>
                                                editField === 'username'
                                                    ? handleSaveClick('username')
                                                    : handleEditClick('username')
                                            }
                                        >
                                            {editField === 'username' ? 'Save' : 'Edit'}
                                        </Button>
                                    </Card.Body>
                                </Card>

                                {/* Display Name */}
                                <Card className="mb-3">
                                    <Card.Body>
                                        <Card.Title>Display Name</Card.Title>
                                        <Card.Text>
                                            {editField === 'displayName' ? (
                                                <FormControl
                                                    value={
                                                        updatedData.displayName ||
                                                        userData.displayName
                                                    }
                                                    onChange={(e) => handleChange(e, 'displayName')}
                                                />
                                            ) : (
                                                userData.displayName
                                            )}
                                        </Card.Text>
                                        <Button
                                            variant="primary"
                                            onClick={() =>
                                                editField === 'displayName'
                                                    ? handleSaveClick('displayName')
                                                    : handleEditClick('displayName')
                                            }
                                        >
                                            {editField === 'displayName' ? 'Save' : 'Edit'}
                                        </Button>
                                    </Card.Body>
                                </Card>

                                {/* Email */}
                                <Card className="mb-3">
                                    <Card.Body>
                                        <Card.Title>Email</Card.Title>
                                        <Card.Text>
                                            {editField === 'email' ? (
                                                <FormControl
                                                    value={updatedData.email || userData.email}
                                                    onChange={(e) => handleChange(e, 'email')}
                                                />
                                            ) : (
                                                userData.email
                                            )}
                                        </Card.Text>
                                        <Button
                                            variant="primary"
                                            onClick={() =>
                                                editField === 'email'
                                                    ? handleSaveClick('email')
                                                    : handleEditClick('email')
                                            }
                                        >
                                            {editField === 'email' ? 'Save' : 'Edit'}
                                        </Button>
                                    </Card.Body>
                                </Card>

                                {/* Role */}
                                <Card className="mb-3">
                                    <Card.Body>
                                        <Card.Title>Role</Card.Title>
                                        <Card.Text>
                                            {editField === 'role' ? (
                                                <FormControl
                                                    value={updatedData.role || userData.role}
                                                    onChange={(e) => handleChange(e, 'role')}
                                                />
                                            ) : (
                                                userData.role
                                            )}
                                        </Card.Text>
                                        <Button
                                            variant="primary"
                                            onClick={() =>
                                                editField === 'role'
                                                    ? handleSaveClick('role')
                                                    : handleEditClick('role')
                                            }
                                        >
                                            {editField === 'role' ? 'Save' : 'Edit'}
                                        </Button>
                                    </Card.Body>
                                </Card>
                            </div>
                        ) : (
                            <p>No user data found</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Settings;
