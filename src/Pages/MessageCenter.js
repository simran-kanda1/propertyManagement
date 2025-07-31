// pages/MessageCenter.js
import React, { useState, useEffect } from 'react';
import { auth } from '../firebase-config';
import { dbService } from '../database-service';
import Layout from '../components/Layout';
import MessageComposer from '../components/MessageComposer';
import ContactSelector from '../components/ContactSelector';
import MessageTemplateModal from '../components/MessageTemplateModal';
import './MessageCenter.css';

const MessageCenter = () => {
  const [userCompany, setUserCompany] = useState(null);
  const [residents, setResidents] = useState([]);
  const [activeTab, setActiveTab] = useState('inbox');
  const [loading, setLoading] = useState(true);
  
  // Message and call data
  const [messages, setMessages] = useState([]);
  const [callLogs, setCallLogs] = useState([]);
  const [filteredData, setFilteredData] = useState([]);
  
  // UI states
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [selectedContact, setSelectedContact] = useState(null);
  const [showComposer, setShowComposer] = useState(false);
  const [showMassMessage, setShowMassMessage] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [composerType, setComposerType] = useState('individual'); // individual, mass, reply

  // Stats
  const [stats, setStats] = useState({
    totalMessages: 0,
    unreadMessages: 0,
    missedCalls: 0,
    todayCalls: 0
  });

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        await loadUserData(user.email);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    filterAndSortData();
  }, [messages, callLogs, searchTerm, statusFilter, dateFilter, activeTab]);

  const loadUserData = async (email) => {
    try {
      const company = await dbService.getCompanyByEmail(email);
      setUserCompany(company);
      
      if (company) {
        await Promise.all([
          loadResidents(company.id),
          loadMessages(company.id),
          loadCallLogs(company.id)
        ]);
      }
    } catch (error) {
      console.error('Error loading user data:', error);
    }
  };

  const loadResidents = async (companyId) => {
    try {
      const residentsData = await dbService.getResidentsByCompany(companyId);
      setResidents(residentsData);
    } catch (error) {
      console.error('Error loading residents:', error);
    }
  };

  const loadMessages = async (companyId) => {
    try {
      const messagesData = await dbService.getMessagesByCompany(companyId);
      setMessages(messagesData);
      updateStats(messagesData, callLogs);
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  };

  const loadCallLogs = async (companyId) => {
    try {
      const callLogsData = await dbService.getCallLogsByCompany(companyId);
      setCallLogs(callLogsData);
      updateStats(messages, callLogsData);
    } catch (error) {
      console.error('Error loading call logs:', error);
    }
  };

  const updateStats = (messagesData, callLogsData) => {
    const today = new Date().toDateString();
    
    setStats({
      totalMessages: messagesData.length,
      unreadMessages: messagesData.filter(m => !m.isRead).length,
      missedCalls: callLogsData.filter(c => c.status === 'missed').length,
      todayCalls: callLogsData.filter(c => 
        new Date(c.timestamp).toDateString() === today
      ).length
    });
  };

  const filterAndSortData = () => {
    let data = [];
    
    if (activeTab === 'inbox' || activeTab === 'outbox') {
      data = messages.filter(message => {
        const isIncoming = message.direction === 'incoming';
        return activeTab === 'inbox' ? isIncoming : !isIncoming;
      });
    } else if (activeTab === 'calls') {
      data = callLogs;
    } else if (activeTab === 'all') {
      data = [...messages, ...callLogs].sort((a, b) => 
        new Date(b.timestamp) - new Date(a.timestamp)
      );
    }

    // Apply filters
    if (searchTerm) {
      data = data.filter(item => {
        const searchLower = searchTerm.toLowerCase();
        return (
          item.phoneNumber?.toLowerCase().includes(searchLower) ||
          item.residentName?.toLowerCase().includes(searchLower) ||
          item.unitNumber?.toLowerCase().includes(searchLower) ||
          item.content?.toLowerCase().includes(searchLower) ||
          item.summary?.toLowerCase().includes(searchLower)
        );
      });
    }

    if (statusFilter !== 'all') {
      data = data.filter(item => {
        if (statusFilter === 'unread') return !item.isRead;
        if (statusFilter === 'read') return item.isRead;
        if (statusFilter === 'missed') return item.status === 'missed';
        if (statusFilter === 'answered') return item.status === 'answered';
        return true;
      });
    }

    if (dateFilter !== 'all') {
      const now = new Date();
      data = data.filter(item => {
        const itemDate = new Date(item.timestamp);
        if (dateFilter === 'today') {
          return itemDate.toDateString() === now.toDateString();
        } else if (dateFilter === 'week') {
          const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
          return itemDate >= weekAgo;
        } else if (dateFilter === 'month') {
          const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
          return itemDate >= monthAgo;
        }
        return true;
      });
    }

    setFilteredData(data);
  };

  const getResidentByPhone = (phoneNumber) => {
    return residents.find(r => r.phone === phoneNumber);
  };

  const markAsRead = async (itemId, type) => {
    try {
      if (type === 'message') {
        await dbService.markMessageAsRead(itemId);
        setMessages(prev => prev.map(m => 
          m.id === itemId ? { ...m, isRead: true } : m
        ));
      }
    } catch (error) {
      console.error('Error marking as read:', error);
    }
  };

  const handleSendMessage = async (messageData) => {
    try {
      if (composerType === 'mass') {
        // Send to all residents
        const messagePromises = residents.map(async (resident) => {
          const newMessage = {
            companyId: userCompany.id,
            phoneNumber: resident.phone,
            residentId: resident.id,
            residentName: resident.name,
            unitNumber: resident.unitNumber,
            content: messageData.content,
            direction: 'outgoing',
            type: 'sms',
            status: 'sent',
            timestamp: new Date(),
            isRead: true,
            sentBy: auth.currentUser?.email
          };
          
          // In real implementation, send via Twilio
          console.log('Sending mass message to:', resident.phone);
          return await dbService.createMessage(userCompany.id, newMessage);
        });
        
        await Promise.all(messagePromises);
        await loadMessages(userCompany.id);
        
      } else if (composerType === 'individual') {
        const resident = selectedContact;
        const newMessage = {
          companyId: userCompany.id,
          phoneNumber: resident.phone,
          residentId: resident.id,
          residentName: resident.name,
          unitNumber: resident.unitNumber,
          content: messageData.content,
          direction: 'outgoing',
          type: 'sms',
          status: 'sent',
          timestamp: new Date(),
          isRead: true,
          sentBy: auth.currentUser?.email
        };
        
        // In real implementation, send via Twilio
        console.log('Sending individual message to:', resident.phone);
        await dbService.createMessage(userCompany.id, newMessage);
        await loadMessages(userCompany.id);
        
      } else if (composerType === 'reply') {
        const originalMessage = selectedMessage;
        const replyMessage = {
          companyId: userCompany.id,
          phoneNumber: originalMessage.phoneNumber,
          residentId: originalMessage.residentId,
          residentName: originalMessage.residentName,
          unitNumber: originalMessage.unitNumber,
          content: messageData.content,
          direction: 'outgoing',
          type: 'sms',
          status: 'sent',
          timestamp: new Date(),
          isRead: true,
          sentBy: auth.currentUser?.email,
          replyTo: originalMessage.id
        };
        
        console.log('Sending reply to:', originalMessage.phoneNumber);
        await dbService.createMessage(userCompany.id, replyMessage);
        await loadMessages(userCompany.id);
      }
      
      setShowComposer(false);
      setShowMassMessage(false);
      setSelectedContact(null);
      setSelectedMessage(null);
      
    } catch (error) {
      console.error('Error sending message:', error);
      alert('Failed to send message. Please try again.');
    }
  };

  const handleReply = (message) => {
    setSelectedMessage(message);
    setComposerType('reply');
    setShowComposer(true);
  };

  const handleIndividualMessage = () => {
    setComposerType('individual');
    setShowComposer(true);
  };

  const handleMassMessage = () => {
    setComposerType('mass');
    setShowMassMessage(true);
  };

  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 1) {
      return `Today ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } else if (diffDays === 2) {
      return `Yesterday ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } else if (diffDays <= 7) {
      return date.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
  };

  const renderStatsCards = () => (
    <div className="stats-cards">
      <div className="stat-card">
        <div className="stat-icon inbox-icon">📨</div>
        <div className="stat-info">
          <span className="stat-number">{stats.unreadMessages}</span>
          <span className="stat-label">Unread</span>
        </div>
      </div>
      <div className="stat-card">
        <div className="stat-icon messages-icon">💬</div>
        <div className="stat-info">
          <span className="stat-number">{stats.totalMessages}</span>
          <span className="stat-label">Total Messages</span>
        </div>
      </div>
      <div className="stat-card">
        <div className="stat-icon calls-icon">📞</div>
        <div className="stat-info">
          <span className="stat-number">{stats.todayCalls}</span>
          <span className="stat-label">Today's Calls</span>
        </div>
      </div>
      <div className="stat-card">
        <div className="stat-icon missed-icon">📵</div>
        <div className="stat-info">
          <span className="stat-number">{stats.missedCalls}</span>
          <span className="stat-label">Missed Calls</span>
        </div>
      </div>
    </div>
  );

  const renderActionButtons = () => (
    <div className="action-buttons">
      <button 
        className="action-btn primary-btn"
        onClick={handleIndividualMessage}
      >
        <span className="btn-icon">✏️</span>
        New Message
      </button>
      <button 
        className="action-btn secondary-btn"
        onClick={handleMassMessage}
      >
        <span className="btn-icon">📢</span>
        Mass Message
      </button>
      <button 
        className="action-btn secondary-btn"
        onClick={() => setShowTemplateModal(true)}
      >
        <span className="btn-icon">📝</span>
        Templates
      </button>
    </div>
  );

  const renderFilters = () => (
    <div className="filters-section">
      <div className="search-box">
        <input
          type="text"
          placeholder="Search messages, calls, or residents..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />
        <span className="search-icon">🔍</span>
      </div>
      
      <div className="filter-dropdowns">
        <select 
          value={statusFilter} 
          onChange={(e) => setStatusFilter(e.target.value)}
          className="filter-select"
        >
          <option value="all">All Status</option>
          <option value="unread">Unread</option>
          <option value="read">Read</option>
          <option value="missed">Missed Calls</option>
          <option value="answered">Answered Calls</option>
        </select>
        
        <select 
          value={dateFilter} 
          onChange={(e) => setDateFilter(e.target.value)}
          className="filter-select"
        >
          <option value="all">All Time</option>
          <option value="today">Today</option>
          <option value="week">This Week</option>
          <option value="month">This Month</option>
        </select>
      </div>
    </div>
  );

  const renderTabs = () => (
    <div className="message-tabs">
      <button 
        className={`tab-btn ${activeTab === 'all' ? 'active' : ''}`}
        onClick={() => setActiveTab('all')}
      >
        All Activity ({messages.length + callLogs.length})
      </button>
      <button 
        className={`tab-btn ${activeTab === 'inbox' ? 'active' : ''}`}
        onClick={() => setActiveTab('inbox')}
      >
        Inbox ({messages.filter(m => m.direction === 'incoming').length})
      </button>
      <button 
        className={`tab-btn ${activeTab === 'outbox' ? 'active' : ''}`}
        onClick={() => setActiveTab('outbox')}
      >
        Sent ({messages.filter(m => m.direction === 'outgoing').length})
      </button>
      <button 
        className={`tab-btn ${activeTab === 'calls' ? 'active' : ''}`}
        onClick={() => setActiveTab('calls')}
      >
        Call Logs ({callLogs.length})
      </button>
    </div>
  );

  const renderMessageList = () => (
    <div className="message-list">
      {filteredData.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📭</div>
          <h3>No messages or calls found</h3>
          <p>Try adjusting your filters or send a new message.</p>
        </div>
      ) : (
        filteredData.map((item) => {
          const resident = getResidentByPhone(item.phoneNumber);
          const isCall = item.type === 'call';
          
          return (
            <div 
              key={item.id} 
              className={`message-item ${!item.isRead ? 'unread' : ''} ${isCall ? 'call-item' : 'message-item'}`}
              onClick={() => !item.isRead && markAsRead(item.id, isCall ? 'call' : 'message')}
            >
              <div className="message-header">
                <div className="contact-info">
                  <div className="contact-avatar">
                    {isCall ? '📞' : '💬'}
                  </div>
                  <div className="contact-details">
                    <h4 className="contact-name">
                      {resident ? `${resident.name} - Unit ${resident.unitNumber}` : item.phoneNumber}
                    </h4>
                    <p className="phone-number">{item.phoneNumber}</p>
                  </div>
                </div>
                
                <div className="message-meta">
                  <span className="timestamp">{formatTimestamp(item.timestamp)}</span>
                  <div className="status-indicators">
                    {!item.isRead && <span className="unread-dot"></span>}
                    <span className={`status-badge ${item.direction || item.status}`}>
                      {isCall ? item.status : item.direction}
                    </span>
                  </div>
                </div>
              </div>
              
              <div className="message-content">
                {isCall ? (
                  <div className="call-details">
                    <p className="call-summary">
                      {item.summary || `${item.status} call - ${item.duration || 'N/A'}`}
                    </p>
                    {item.aiSummary && (
                      <p className="ai-summary">🤖 {item.aiSummary}</p>
                    )}
                  </div>
                ) : (
                  <div className="message-details">
                    <p className="message-text">{item.content}</p>
                    {item.aiSummary && (
                      <p className="ai-summary">🤖 {item.aiSummary}</p>
                    )}
                  </div>
                )}
              </div>
              
              {!isCall && (
                <div className="message-actions">
                  <button 
                    className="action-btn small-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleReply(item);
                    }}
                  >
                    Reply
                  </button>
                  {resident && (
                    <button 
                      className="action-btn small-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        // Navigate to resident profile
                        console.log('View resident profile:', resident.id);
                      }}
                    >
                      View Profile
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );

  if (loading) {
    return (
      <Layout currentPageName="Message Center">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading messages and call logs...</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout currentPageName="Message Center">
      <div className="message-center">
        {renderStatsCards()}
        {renderActionButtons()}
        {renderFilters()}
        {renderTabs()}
        {renderMessageList()}
        
        {/* Composer Modals */}
        {showComposer && (
          <MessageComposer
            isOpen={showComposer}
            onClose={() => {
              setShowComposer(false);
              setSelectedContact(null);
              setSelectedMessage(null);
            }}
            onSend={handleSendMessage}
            residents={residents}
            selectedContact={selectedContact}
            setSelectedContact={setSelectedContact}
            replyTo={composerType === 'reply' ? selectedMessage : null}
            type={composerType}
          />
        )}
        
        {showMassMessage && (
          <MessageComposer
            isOpen={showMassMessage}
            onClose={() => setShowMassMessage(false)}
            onSend={handleSendMessage}
            residents={residents}
            type="mass"
          />
        )}
        
        {showTemplateModal && (
          <MessageTemplateModal
            isOpen={showTemplateModal}
            onClose={() => setShowTemplateModal(false)}
            onSelectTemplate={(template) => {
              setShowTemplateModal(false);
              // Handle template selection
            }}
          />
        )}
      </div>
    </Layout>
  );
};

export default MessageCenter;