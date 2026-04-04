import { useState } from 'react';
import '../App.css';
import arrows from '../assets/arrows.svg';
import avatar from '../assets/avatar.svg';
import axios from 'axios';
import { useNavigate } from 'react-router';

type Question = {
    questionId: number;
    title: string;
    difficulty: string;
    category: string;
};

const Home = () => {
    const name = localStorage.getItem('name') || 'User';
    const accessToken = localStorage.getItem('accessToken');
    const navigate = useNavigate();
    const [difficulty, setDifficulty] = useState('');
    const [category, setCategory] = useState('');
    const [filteredQuestions, setFilteredQuestions] = useState<Question[]>([]);

    const handleSearch = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        console.log('accessToken in Home:', accessToken);
        try {
            const response = await axios.get('http://localhost:3002/questions', {
                params: {
                    difficulty,
                    category,
                },
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            });
            // console.log('Search response:', response.data);
            // const qidList = response.data.map((q: any) => q.id);
            // console.log('Question IDs:', qidList);
            // setFilteredQuestions(response.data);

            const questions = response.data.map((q: any) => ({
                questionId: q.questionId,
                title: q.title,
                difficulty: q.difficulty,
                category: q.categories?.join(', ') ?? '',
            }));

            console.log('Mapped questions:', questions);
            setFilteredQuestions(questions);
        } catch (err) {
            console.error('Search error:', err);
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('name');
        navigate('/');
    };
    return (
        <>
            <div>
                <nav className="navbar navbar-light" style={{ backgroundColor: '#dedede' }}>
                    <div className="container-fluid d-flex justify-content-between align-items-center">
                        <a
                            className="navbar-brand d-flex align-items-center"
                            href="#"
                            style={{ gap: '2px', marginBottom: 0 }}
                        >
                            <img src={arrows} width="30" height="30" alt="logo" />
                            <span>PeerPrep</span>
                        </a>

                        <div
                            className="button-container dropdown d-flex align-items-center"
                            style={{ marginRight: '1px', gap: '6px' }}
                        >
                            <img
                                src={avatar}
                                alt="avatar"
                                width="30"
                                height="30"
                                style={{ borderRadius: '50%' }}
                            />

                            <button
                                className="btn dropdown-toggle"
                                type="button"
                                id="userDropdown"
                                data-bs-toggle="dropdown"
                                aria-expanded="false"
                                style={{
                                    fontSize: '15px',
                                    border: 'none',
                                    background: 'transparent',
                                    padding: 0,
                                    color: 'black',
                                }}
                            >
                                {name}
                            </button>

                            <ul
                                className="dropdown-menu dropdown-menu-end"
                                aria-labelledby="userDropdown"
                            >
                                <li>
                                    <a className="dropdown-item" href="#">
                                        Profile
                                    </a>
                                </li>
                                <li>
                                    <a className="dropdown-item" href="#">
                                        Settings
                                    </a>
                                </li>
                                <li>
                                    <button
                                        className="dropdown-item"
                                        w-idth="100%"
                                        onClick={handleLogout}
                                        style={{ color: 'black' }}
                                    >
                                        Logout
                                    </button>
                                </li>
                            </ul>
                        </div>
                    </div>
                </nav>
            </div>
            <div className="container mt-4">
                <h1>Welcome, {name}!</h1>
                <p className="text-muted">Choose a difficulty and category to find questions</p>
            </div>
            <div className="container py-5">
                <div className="card shadow-sm mb-5">
                    <div className="card-body">
                        <form onSubmit={handleSearch} className="row g-3">
                            <div className="col-md-6">
                                <label htmlFor="difficulty" className="form-label fw-bold">
                                    Difficulty
                                </label>
                                <select
                                    id="difficulty"
                                    className="form-select"
                                    value={difficulty}
                                    onChange={(e) => setDifficulty(e.target.value)}
                                >
                                    <option value="">All</option>
                                    <option value="Easy">Easy</option>
                                    <option value="Medium">Medium</option>
                                    <option value="Hard">Hard</option>
                                </select>
                            </div>
                            <div className="col-md-6">
                                <label htmlFor="category" className="form-label fw-bold">
                                    Category
                                </label>
                                <select
                                    id="category"
                                    className="form-select"
                                    value={category}
                                    onChange={(e) => setCategory(e.target.value)}
                                >
                                    <option value="">All</option>
                                    <option value="Array">Array</option>
                                    <option value="String">String</option>
                                    <option value="Linked List">Linked List</option>
                                </select>
                            </div>
                            <div className="center-button mt-4">
                                <button type="submit" className="btn btn-secondary">
                                    Search
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
                <div className="mt-4">
                    <h3 className="mb-3">Matching Questions</h3>

                    {filteredQuestions.length === 0 ? (
                        <p className="text-muted">No questions found.</p>
                    ) : (
                        <div className="row g-4">
                            {filteredQuestions.map((q) => (
                                <div key={q.questionId} className="col-md-6 col-lg-4">
                                    <div className="card h-100 shadow-sm">
                                        <div className="card-body">
                                            <h5 className="card-title">{q.title}</h5>
                                            <p className="card-text text-muted mb-2">
                                                Difficulty: {q.difficulty}
                                            </p>
                                            <p className="card-text text-muted">
                                                Category: {q.category}
                                            </p>
                                            <button className="btn btn-outline-primary btn-sm">
                                                View Question
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};

export default Home;
